import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, inject } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { checkmarkCircleOutline } from 'ionicons/icons';

import type { MovementAlert } from '../home/movement-alert';
import { NATIVE_ALARM } from '../home/native-alarm';
import { AlertHistoryService } from '../services/alert-history/alert-history.service';

@Component({
  selector: 'app-alert-history',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './alert-history.page.html',
  styleUrls: ['./alert-history.page.scss'],
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    RouterLink,
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonToolbar,
  ],
})
export class AlertHistoryPage implements OnInit, OnDestroy {
  history = inject(AlertHistoryService);
  historyFilter = 'All';
  historyDate = this.localDate(new Date());
  feedback = '';

  private changeDetector = inject(ChangeDetectorRef);
  private alertController = inject(AlertController);
  private nativeAlarm = inject(NATIVE_ALARM);
  private nativeListener: PluginListenerHandle | null = null;
  private destroyed = false;

  constructor() {
    addIcons({ checkmarkCircleOutline });
  }

  async ngOnInit(): Promise<void> {
    if (!this.history.isAndroidApp) {
      return;
    }
    try {
      this.nativeListener = await this.nativeAlarm.addListener('stateChanged', () => {
        void this.loadHistory();
      });
      if (this.destroyed) {
        await this.nativeListener.remove();
      }
    } catch {
      this.history.storageError = 'Live history updates are unavailable. Reopen this page to refresh the logs.';
      this.changeDetector.markForCheck();
    }
  }

  ionViewWillEnter(): void {
    this.showToday();
    void this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    await this.history.refresh();
    if (!this.destroyed) {
      this.changeDetector.markForCheck();
    }
  }

  get visibleAlerts(): MovementAlert[] {
    const matchingAlerts: MovementAlert[] = [];
    for (const alert of this.history.alerts) {
      if (this.historyDate && this.localDate(new Date(alert.createdAt)) !== this.historyDate) {
        continue;
      }
      if (this.historyFilter === 'All' || alert.status === this.historyFilter) {
        matchingAlerts.push(alert);
      }
    }
    return matchingAlerts;
  }

  get newAlertCount(): number {
    let count = 0;
    for (const alert of this.history.alerts) {
      if (this.historyDate && this.localDate(new Date(alert.createdAt)) !== this.historyDate) {
        continue;
      }
      if (alert.status === 'New') {
        count++;
      }
    }
    return count;
  }

  showToday(): void {
    this.historyDate = this.localDate(new Date());
  }

  private localDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  async toggleStatus(alert: MovementAlert): Promise<void> {
    let newStatus: MovementAlert['status'] = 'New';
    if (alert.status === 'New') {
      newStatus = 'Reviewed';
    }
    try {
      await this.history.setAlertStatus(alert.id, newStatus);
      this.feedback = 'Alert marked ' + newStatus.toLowerCase() + '.';
    } catch (error) {
      this.showError(error, 'Could not update the alert. Try again.');
    }
    this.changeDetector.markForCheck();
  }

  async confirmDelete(alert: MovementAlert): Promise<void> {
    const dialog = await this.alertController.create({
      header: 'Delete this alert?',
      message: 'This removes the alert from your account on all devices.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            void this.deleteAlert(alert.id);
          },
        },
      ],
    });
    await dialog.present();
  }

  private async deleteAlert(id: string): Promise<void> {
    try {
      await this.history.deleteAlert(id);
      this.feedback = 'Alert deleted.';
    } catch (error) {
      this.showError(error, 'Could not delete the alert. Try again.');
    }
    this.changeDetector.markForCheck();
  }

  async confirmClearHistory(): Promise<void> {
    const dialog = await this.alertController.create({
      header: 'Clear all alert history?',
      message: 'All saved alerts in your account will be deleted on all devices. This cannot be undone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Clear history',
          role: 'destructive',
          handler: () => {
            void this.clearHistory();
          },
        },
      ],
    });
    await dialog.present();
  }

  private async clearHistory(): Promise<void> {
    try {
      await this.history.clearHistory();
      this.historyFilter = 'All';
      this.feedback = 'Alert history cleared.';
    } catch (error) {
      this.showError(error, 'History could not be cleared. Check device storage and try again.');
    }
    this.changeDetector.markForCheck();
  }

  private showError(error: unknown, fallback: string): void {
    this.feedback = '';
    this.history.storageError = fallback;
    if (error instanceof Error) {
      this.history.storageError = error.message;
    }
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (!document.hidden && this.history.isAndroidApp) {
      void this.loadHistory();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.nativeListener) {
      void this.nativeListener.remove();
    }
  }
}
