import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { PluginListenerHandle } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';
import {
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonToggle,
  IonToolbar,
  NavController,
} from '@ionic/angular';

import { NATIVE_ALARM } from '../home/native-alarm';
import { AlarmSettingsService } from '../services/alarm-settings/alarm-settings.service';
import { AuthService } from '../services/auth/auth.service';
import { ThemeService } from '../services/theme/theme.service';

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  imports: [FormsModule, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonToggle, IonToolbar],
})
export class SettingsPage implements OnInit, OnDestroy {
  theme = inject(ThemeService);
  settings = inject(AlarmSettingsService);
  auth = inject(AuthService);
  signOutState: 'idle' | 'confirming' | 'signing-out' = 'idle';
  private alertController = inject(AlertController);
  private navigation = inject(NavController);
  isAndroidApp = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  settingsLoaded = !this.isAndroidApp;
  error = '';

  private nativeAlarm = inject(NATIVE_ALARM);
  private changeDetector = inject(ChangeDetectorRef);
  private nativeListener: PluginListenerHandle | null = null;
  private destroyed = false;

  get settingsLocked(): boolean {
    return !this.settingsLoaded || this.settings.state !== 'idle';
  }

  async ngOnInit(): Promise<void> {
    if (!this.isAndroidApp) {
      return;
    }
    try {
      this.nativeListener = await this.nativeAlarm.addListener('stateChanged', () => {
        void this.loadSettings();
      });
      if (this.destroyed) {
        await this.nativeListener.remove();
      }
    } catch {
      this.error = 'Live settings updates are unavailable. Reopen this page to refresh.';
      this.changeDetector.markForCheck();
    }
  }

  ionViewWillEnter(): void {
    if (this.isAndroidApp) {
      void this.loadSettings();
    }
  }

  async signOut(): Promise<void> {
    if (this.signOutState !== 'idle') {
      return;
    }

    this.signOutState = 'confirming';
    try {
      const dialog = await this.alertController.create({
        header: 'Sign out of this device?',
        cssClass: 'sign-out-confirmation',
        buttons: [
          { text: 'Cancel', role: 'cancel' },
          { text: 'Sign out', role: 'confirm' },
        ],
      });
      await dialog.present();
      const answer = await dialog.onDidDismiss();
      if (answer.role !== 'confirm') {
        return;
      }

      this.signOutState = 'signing-out';
      this.error = '';
      this.changeDetector.markForCheck();
      await this.auth.logout();
      await this.navigation.navigateRoot('/login');
    } catch (error) {
      this.error = 'Could not sign out. Try again.';
      if (error instanceof Error) {
        this.error = error.message;
      }
    } finally {
      this.signOutState = 'idle';
      this.changeDetector.markForCheck();
    }
  }

  private async loadSettings(): Promise<void> {
    try {
      const androidSettings = await this.nativeAlarm.getState();
      if (!this.destroyed) {
        this.settings.applyNativeSettings(androidSettings);
        this.settingsLoaded = true;
        this.error = '';
      }
    } catch {
      this.settingsLoaded = false;
      this.error = 'Could not read Android monitoring settings. Return to the monitor and try again.';
    }
    if (!this.destroyed) {
      this.changeDetector.markForCheck();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.nativeListener) {
      void this.nativeListener.remove();
    }
  }
}
