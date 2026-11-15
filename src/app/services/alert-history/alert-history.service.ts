import { effect, inject, Injectable, signal } from '@angular/core';
import type { OnDestroy } from '@angular/core';
import { Capacitor } from '@capacitor/core';

import type { MovementAlert } from '../../home/movement-alert';
import { NATIVE_ALARM } from '../../home/native-alarm';
import { ApiError, ApiService } from '../api/api.service';
import { AuthService } from '../auth/auth.service';

type AlertChange =
  | { method: 'POST'; id: string; alert: MovementAlert }
  | { method: 'PATCH'; id: string; status: 'New' | 'Reviewed' }
  | { method: 'DELETE'; id: string };

interface AlertRow {
  id: string;
  created_at: string;
  source: 'Movement';
  status: 'New' | 'Reviewed';
  strength: number | null;
}

@Injectable({
  providedIn: 'root',
})
export class AlertHistoryService implements OnDestroy {
  readonly isAndroidApp = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  readonly offline = signal(!navigator.onLine);
  readonly showingCache = signal(true);
  private readonly savedAlerts = signal<MovementAlert[]>([]);
  private readonly unsyncedAndroidAlerts = signal<MovementAlert[]>([]);
  private readonly pendingCount = signal(0);
  private readonly loading = signal(true);
  private readonly error = signal('');
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly nativeAlarm = inject(NATIVE_ALARM);
  private pendingChanges: AlertChange[] = [];
  private historyOwnerId = '';
  private activeUserId?: string;
  private prepareHistoryRequest?: Promise<void>;
  private syncInProgress?: Promise<void>;
  private clearing = false;

  private readonly onOnline = () => {
    this.offline.set(false);
    void this.refresh();
  };
  private readonly onOffline = () => {
    this.offline.set(true);
    this.showingCache.set(true);
  };
  private readonly pollTimer = window.setInterval(() => {
    if (!document.hidden && this.auth.user()) {
      void this.refresh();
    }
  }, 5000);

  constructor() {
    effect(() => {
      const user = this.auth.user();
      const userId = user?.uid ?? '';
      if (this.activeUserId === userId) {
        return;
      }

      this.activeUserId = userId;
      this.historyOwnerId = '';
      this.prepareHistoryRequest = undefined;
      this.syncInProgress = undefined;
      this.pendingChanges = [];
      this.pendingCount.set(0);
      this.savedAlerts.set([]);
      this.unsyncedAndroidAlerts.set([]);
      this.error.set('');
      this.showingCache.set(true);
      this.loading.set(!!user);
      if (user) {
        this.loadCache(user.uid);
        void this.refresh();
      }
    });
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
  }

  get alerts(): MovementAlert[] {
    const alerts = [...this.savedAlerts()];
    for (const alert of this.unsyncedAndroidAlerts()) {
      const alreadySaved = alerts.some((savedAlert) => savedAlert.id === alert.id);
      if (!alreadySaved) {
        alerts.push(alert);
      }
    }
    return alerts.sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  }
  get loadingHistory(): boolean {
    return this.loading();
  }
  set loadingHistory(value: boolean) {
    this.loading.set(value);
  }
  get storageError(): string {
    return this.error();
  }
  set storageError(value: string) {
    this.error.set(value);
  }
  get hasUnsyncedChanges(): boolean {
    return this.pendingCount() > 0 || this.unsyncedAndroidAlerts().length > 0;
  }
  isAndroidAlertUnsynced(id: string): boolean {
    return this.unsyncedAndroidAlerts().some((alert) => alert.id === id);
  }

  async prepareAndroidHistory(): Promise<void> {
    if (!this.isAndroidApp) {
      return;
    }

    const userId = this.requireUser();
    if (this.historyOwnerId === userId) {
      return this.prepareHistoryRequest;
    }

    this.historyOwnerId = userId;
    this.prepareHistoryRequest = this.nativeAlarm.setHistoryOwner({ userId });
    try {
      await this.prepareHistoryRequest;
    } catch (error) {
      if (this.historyOwnerId === userId) {
        this.historyOwnerId = '';
      }
      throw error;
    }
  }

  async refresh(): Promise<void> {
    const userId = this.auth.user()?.uid;
    if (!userId || this.clearing) {
      return;
    }
    if (this.syncInProgress) {
      return this.syncInProgress;
    }

    const syncRequest = this.syncUserAlerts(userId);
    this.syncInProgress = syncRequest;
    try {
      await syncRequest;
    } finally {
      if (this.syncInProgress === syncRequest) {
        this.syncInProgress = undefined;
      }
    }
  }

  private async syncUserAlerts(userId: string): Promise<void> {
    try {
      await this.prepareAndroidHistory();
      if (!this.isCurrentUser(userId)) {
        return;
      }
      if (this.isAndroidApp) {
        const androidState = await this.nativeAlarm.getState();
        if (!this.isCurrentUser(userId)) {
          return;
        }
        if (androidState.historyOwner === userId) {
          this.unsyncedAndroidAlerts.set(androidState.alerts.filter(isMovementAlert));
        }
      }
      if (!navigator.onLine) {
        return;
      }

      while (this.pendingChanges.length > 0 && this.isCurrentUser(userId)) {
        const change = this.pendingChanges[0];
        const accessToken = await this.auth.getAccessToken(userId);
        try {
          if (change.method === 'POST') {
            await this.uploadMovementAlert(change.alert, accessToken);
          } else {
            const path = '/rest/v1/alerts?id=eq.' + encodeURIComponent(change.id);
            if (change.method === 'PATCH') {
              await this.api.request(path, 'PATCH', { status: change.status }, accessToken);
            } else {
              await this.api.request(path, 'DELETE', undefined, accessToken);
            }
          }
        } catch (error) {
          const alertWasAlreadyDeleted = error instanceof ApiError && error.status === 404 && change.method !== 'POST';
          if (!alertWasAlreadyDeleted) {
            throw error;
          }
        }
        if (!this.isCurrentUser(userId) || this.pendingChanges[0] !== change) {
          return;
        }
        this.pendingChanges.shift();
        this.saveCache(userId);
      }

      for (const alert of this.unsyncedAndroidAlerts()) {
        const accessToken = await this.auth.getAccessToken(userId);
        await this.uploadMovementAlert(alert, accessToken);
        if (!this.isCurrentUser(userId)) {
          return;
        }
        await this.nativeAlarm.deleteAlert({ id: alert.id, userId });
        if (!this.isCurrentUser(userId)) {
          return;
        }
        this.unsyncedAndroidAlerts.update((pendingAlerts) =>
          pendingAlerts.filter((pendingAlert) => pendingAlert.id !== alert.id),
        );
      }

      const accessToken = await this.auth.getAccessToken(userId);
      const alerts = await this.loadSavedAlerts(accessToken);
      if (!this.isCurrentUser(userId)) {
        return;
      }
      this.savedAlerts.set(this.applyChanges(alerts.filter(isMovementAlert), this.pendingChanges));
      this.showingCache.set(false);
      this.error.set('');
      this.saveCache(userId);
    } catch (error) {
      if (this.isCurrentUser(userId)) {
        this.showingCache.set(true);
        this.storageError = 'Could not sync your alerts. Please try again.';
        if (error instanceof Error) {
          this.storageError = error.message;
        }
        if (error instanceof ApiError && error.status === 401) {
          this.auth.expireLogin(userId);
        }
      }
    } finally {
      if (this.isCurrentUser(userId)) {
        this.loading.set(false);
      }
    }
  }

  private async uploadMovementAlert(alert: MovementAlert, accessToken: string): Promise<void> {
    await this.api.request(
      '/rest/v1/rpc/record_movement_alert',
      'POST',
      {
        p_id: alert.id,
        p_created_at: alert.createdAt,
        p_strength: alert.strength,
      },
      accessToken,
    );
  }

  private async loadSavedAlerts(accessToken: string): Promise<MovementAlert[]> {
    const alerts: MovementAlert[] = [];
    let offset = 0;
    while (true) {
      const path =
        '/rest/v1/alerts?select=id,created_at,source,status,strength&order=created_at.desc,id.desc&limit=1000&offset=' +
        offset;
      const rows = await this.api.request<AlertRow[]>(path, 'GET', undefined, accessToken);
      for (const row of rows) {
        alerts.push({
          id: row.id,
          createdAt: row.created_at,
          source: row.source,
          status: row.status,
          strength: row.strength,
        });
      }
      if (rows.length < 1000) {
        return alerts;
      }
      offset += rows.length;
    }
  }

  showUnsyncedAndroidAlerts(alerts: MovementAlert[], historyOwner?: string): void {
    const userId = this.auth.user()?.uid;
    if (!userId || historyOwner !== userId || this.historyOwnerId !== userId) {
      return;
    }
    this.unsyncedAndroidAlerts.set(alerts.filter(isMovementAlert));
    void this.refresh();
  }

  recordMovement(movementLevel: number): void {
    const alert: MovementAlert = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      source: 'Movement',
      status: 'New',
      strength: movementLevel,
    };
    this.queueChange({ method: 'POST', id: alert.id, alert });
  }

  async setAlertStatus(id: string, status: MovementAlert['status']): Promise<void> {
    if (this.isAndroidAlertUnsynced(id)) {
      throw new Error('Wait for this alert to sync before changing it.');
    }
    this.queueChange({ method: 'PATCH', id, status });
    await this.refresh();
  }

  async deleteAlert(id: string): Promise<void> {
    if (this.isAndroidAlertUnsynced(id)) {
      throw new Error('Wait for this alert to sync before changing it.');
    }
    this.queueChange({ method: 'DELETE', id });
    await this.refresh();
  }

  async clearHistory(): Promise<void> {
    const userId = this.requireUser();
    await this.refresh();
    if (this.hasUnsyncedChanges) {
      throw new Error('Wait for your alerts to finish syncing before clearing history.');
    }
    this.clearing = true;
    try {
      await this.api.request(
        '/rest/v1/alerts?user_id=eq.' + encodeURIComponent(userId),
        'DELETE',
        undefined,
        await this.auth.getAccessToken(userId),
      );
      if (this.isCurrentUser(userId)) {
        this.savedAlerts.set([]);
        this.saveCache(userId);
      }
    } finally {
      this.clearing = false;
    }
    await this.refresh();
  }

  private queueChange(change: AlertChange): void {
    const userId = this.requireUser();
    this.pendingChanges.push(change);
    this.savedAlerts.set(this.applyChanges(this.savedAlerts(), [change]));
    this.saveCache(userId);
    void this.refresh();
  }

  private applyChanges(alerts: MovementAlert[], changes: AlertChange[]): MovementAlert[] {
    let updatedAlerts = [...alerts];
    for (const change of changes) {
      if (change.method === 'POST') {
        if (!updatedAlerts.some((alert) => alert.id === change.id)) {
          updatedAlerts.unshift(change.alert);
        }
      } else if (change.method === 'PATCH') {
        for (let index = 0; index < updatedAlerts.length; index++) {
          const alert = updatedAlerts[index];
          if (alert.id === change.id) {
            updatedAlerts[index] = { ...alert, status: change.status };
          }
        }
      } else {
        updatedAlerts = updatedAlerts.filter((alert) => alert.id !== change.id);
      }
    }
    return updatedAlerts;
  }

  private loadCache(userId: string): void {
    try {
      const saved = localStorage.getItem('motion-alarm-supabase-history-' + userId);
      if (!saved) {
        return;
      }
      const cache = JSON.parse(saved) as { alerts: unknown[]; changes: AlertChange[] };
      if (
        !Array.isArray(cache.alerts) ||
        !cache.alerts.every(isMovementAlert) ||
        !Array.isArray(cache.changes) ||
        !cache.changes.every(isAlertChange)
      ) {
        throw new Error('Invalid cache');
      }
      this.savedAlerts.set(cache.alerts);
      this.pendingChanges = cache.changes;
      this.pendingCount.set(this.pendingChanges.length);
    } catch {
      this.storageError = 'Cached history could not be read. Reconnect to load your saved alerts.';
    }
  }

  private saveCache(userId: string): void {
    this.pendingCount.set(this.pendingChanges.length);
    try {
      localStorage.setItem(
        'motion-alarm-supabase-history-' + userId,
        JSON.stringify({ alerts: this.savedAlerts(), changes: this.pendingChanges }),
      );
    } catch {
      this.storageError = 'This device could not save offline changes. Keep the app open until syncing finishes.';
    }
  }

  private isCurrentUser(userId: string): boolean {
    return this.auth.user()?.uid === userId;
  }
  private requireUser(): string {
    const userId = this.auth.user()?.uid;
    if (!userId) {
      throw new Error('Log in to access your alerts.');
    }
    return userId;
  }

  ngOnDestroy(): void {
    window.clearInterval(this.pollTimer);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
  }
}

export function isMovementAlert(value: unknown): value is MovementAlert {
  if (typeof value !== 'object' || value === null) return false;
  const alert = value as MovementAlert;
  return (
    typeof alert.id === 'string' &&
    /^[A-Za-z0-9_-]{1,128}$/.test(alert.id) &&
    typeof alert.createdAt === 'string' &&
    Number.isFinite(Date.parse(alert.createdAt)) &&
    alert.source === 'Movement' &&
    (alert.status === 'New' || alert.status === 'Reviewed') &&
    (alert.strength === null ||
      (typeof alert.strength === 'number' &&
        Number.isFinite(alert.strength) &&
        alert.strength >= 0 &&
        alert.strength <= 10000))
  );
}

function isAlertChange(value: unknown): value is AlertChange {
  if (typeof value !== 'object' || value === null) return false;
  const change = value as AlertChange;
  if (typeof change.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(change.id)) return false;
  if (change.method === 'POST')
    return isMovementAlert(change.alert) && change.alert.id === change.id && change.alert.status === 'New';
  if (change.method === 'PATCH') return change.status === 'New' || change.status === 'Reviewed';
  return change.method === 'DELETE';
}
