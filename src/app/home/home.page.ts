import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, inject } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PluginListenerHandle } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';
import { Haptics } from '@capacitor/haptics';
import type { AccelListenerEvent } from '@capacitor/motion';
import { Motion } from '@capacitor/motion';
import { IonButton, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { settingsOutline, shieldCheckmarkOutline, shieldOutline, warningOutline } from 'ionicons/icons';

import { AlarmSettingsService } from '../services/alarm-settings/alarm-settings.service';
import { AlertHistoryService } from '../services/alert-history/alert-history.service';

import { AlarmSound } from './alarm-sound';
import { NATIVE_ALARM } from './native-alarm';
import type { NativeAlarmState } from './native-alarm';

type MotionPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

const COUNTDOWN_SECONDS = 5;

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [DecimalPipe, RouterLink, IonButton, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar],
})
export class HomePage implements OnInit, OnDestroy {
  history = inject(AlertHistoryService);
  settings = inject(AlarmSettingsService);
  countdownSeconds = COUNTDOWN_SECONDS;
  isAndroidApp = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  androidAlarmReady = false;
  movementLevel = 0;
  sensorError = '';
  feedback = '';
  isStoppingAlarm = false;
  stopError = '';

  private changeDetector = inject(ChangeDetectorRef);
  private motionListener: PluginListenerHandle | null = null;
  private countdownTimer: number | null = null;
  private receivedMotion = false;
  private destroyed = false;
  private restingX = 0;
  private restingY = 0;
  private restingZ = 0;
  private alarmSound = new AlarmSound();
  private nativeAlarm = inject(NATIVE_ALARM);
  private nativeListener: PluginListenerHandle | null = null;

  constructor() {
    addIcons({ settingsOutline, shieldCheckmarkOutline, shieldOutline, warningOutline });
  }

  ngOnInit(): void {
    if (this.isAndroidApp) {
      void this.connectToAndroidAlarm();
    }
  }

  private async connectToAndroidAlarm(): Promise<void> {
    try {
      this.nativeListener = await this.nativeAlarm.addListener('stateChanged', () => {
        void this.readAndroidAlarmState();
      });
      if (this.destroyed) {
        await this.nativeListener.remove();
        return;
      }
      await this.history.prepareAndroidHistory();
      await this.readAndroidAlarmState();
    } catch (error) {
      this.sensorError = this.errorMessage(error, 'Could not connect to Android background monitoring.');
      await this.readAndroidAlarmState();
    } finally {
      this.androidAlarmReady = true;
      this.history.loadingHistory = false;
      this.changeDetector.markForCheck();
    }
  }

  private showAndroidAlarmState(androidState: NativeAlarmState): void {
    if (this.destroyed) {
      return;
    }
    this.settings.applyNativeSettings(androidState);
    this.countdownSeconds = androidState.countdown;
    this.movementLevel = androidState.strength;
    this.history.showUnsyncedAndroidAlerts(androidState.alerts, androidState.historyOwner);
    this.sensorError = androidState.message;
    this.changeDetector.markForCheck();
  }

  private async readAndroidAlarmState(): Promise<void> {
    try {
      const androidState = await this.nativeAlarm.getState();
      this.showAndroidAlarmState(androidState);
    } catch (error) {
      this.history.storageError = this.errorMessage(error, 'Could not read Android alert history.');
      this.changeDetector.markForCheck();
    }
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) {
      return error.message;
    }
    return fallback;
  }

  async startAlarm(): Promise<void> {
    if (this.settings.state !== 'idle' || this.isStoppingAlarm) {
      return;
    }
    this.sensorError = '';
    this.feedback = '';
    this.stopError = '';

    if (this.isAndroidApp) {
      await this.startAndroidMonitoring();
    } else {
      await this.startBrowserMonitoring();
    }
  }

  private async startAndroidMonitoring(): Promise<void> {
    if (!this.androidAlarmReady) {
      return;
    }
    this.settings.state = 'starting';
    try {
      await this.history.prepareAndroidHistory();
      await this.nativeAlarm.start({
        threshold: this.settings.threshold,
        soundEnabled: this.settings.soundEnabled,
        vibrationEnabled: this.settings.vibrationEnabled,
      });
      await this.readAndroidAlarmState();
    } catch (error) {
      this.settings.state = 'idle';
      this.sensorError = this.errorMessage(error, 'Could not start Android background monitoring.');
    }
    this.changeDetector.markForCheck();
  }

  private async startBrowserMonitoring(): Promise<void> {
    if (!window.isSecureContext || typeof DeviceMotionEvent === 'undefined') {
      this.sensorError =
        'Motion needs a supported phone and a secure connection (HTTPS or the installed app). You can still create a test alert below.';
      return;
    }

    this.settings.state = 'starting';
    try {
      await this.askForBrowserPermissions();

      if (this.destroyed || document.hidden || this.settings.state !== 'starting') {
        this.settings.state = 'idle';
        return;
      }

      this.receivedMotion = false;
      this.movementLevel = 0;
      this.motionListener = await Motion.addListener('accel', (event) => {
        this.measureMovement(event);
      });

      if (this.destroyed || document.hidden || this.settings.state !== 'starting') {
        await this.stopAlarm();
        return;
      }

      this.startCountdown();
    } catch (error) {
      await this.stopAlarm();
      this.sensorError = this.errorMessage(error, 'Could not start the motion sensor. Check permission and try again.');
    } finally {
      this.changeDetector.markForCheck();
    }
  }

  private async askForBrowserPermissions(): Promise<void> {
    const motionEvent = DeviceMotionEvent as MotionPermission;
    let motionPermissionRequest = Promise.resolve('granted');
    let audioRequest = Promise.resolve();

    if (typeof motionEvent.requestPermission === 'function') {
      motionPermissionRequest = motionEvent.requestPermission();
    }
    if (this.settings.soundEnabled) {
      audioRequest = this.alarmSound.prepare();
    }

    const [permission] = await Promise.all([motionPermissionRequest, audioRequest]);
    if (permission !== 'granted') {
      throw new Error(
        'Motion permission was denied. Allow Motion & Orientation in your browser settings, then arm again.',
      );
    }
  }

  private startCountdown(): void {
    this.countdownSeconds = COUNTDOWN_SECONDS;
    this.settings.state = 'countdown';
    this.countdownTimer = window.setInterval(() => {
      this.updateCountdown();
    }, 1000);
  }

  private updateCountdown(): void {
    this.countdownSeconds--;
    if (this.countdownSeconds === 0) {
      this.clearCountdown();
      if (this.receivedMotion) {
        this.settings.state = 'armed';
      } else {
        void this.stopAlarm();
        this.sensorError =
          'No motion readings arrived. Try a supported phone, check sensor permission, and arm again. Test alerts work without a sensor.';
      }
    }
    this.changeDetector.markForCheck();
  }

  private measureMovement(event: AccelListenerEvent): void {
    const alarmState = this.settings.state;
    if (alarmState === 'idle' || alarmState === 'alert') {
      return;
    }

    const reading = event.accelerationIncludingGravity;
    if (!reading) {
      return;
    }
    if (!Number.isFinite(reading.x) || !Number.isFinite(reading.y) || !Number.isFinite(reading.z)) {
      return;
    }

    this.receivedMotion = true;
    if (alarmState !== 'armed') {
      this.restingX = reading.x;
      this.restingY = reading.y;
      this.restingZ = reading.z;
      return;
    }

    const changeX = reading.x - this.restingX;
    const changeY = reading.y - this.restingY;
    const changeZ = reading.z - this.restingZ;
    this.movementLevel = Math.hypot(changeX, changeY, changeZ);

    if (this.movementLevel >= this.settings.threshold) {
      this.ringBrowserAlarm();
    }
    this.changeDetector.markForCheck();
  }

  private ringBrowserAlarm(): void {
    this.settings.state = 'alert';
    this.history.recordMovement(this.movementLevel);
    void this.vibratePhone();
    if (this.settings.soundEnabled) {
      try {
        this.alarmSound.start();
      } catch (error) {
        this.feedback = this.errorMessage(error, 'The alarm sound could not start.');
      }
    }
  }

  async stopAlarm(): Promise<void> {
    if (this.isAndroidApp) {
      if (this.isStoppingAlarm) {
        return;
      }
      this.isStoppingAlarm = true;
      this.stopError = '';
      this.changeDetector.markForCheck();
      try {
        const androidState = await this.nativeAlarm.stop();
        this.showAndroidAlarmState(androidState);
      } catch (error) {
        this.stopError = this.errorMessage(error, 'Verification did not finish. Tap Motion alarm stop to try again.');
      } finally {
        this.isStoppingAlarm = false;
        this.changeDetector.markForCheck();
      }
      return;
    }
    this.alarmSound.stop();
    this.clearCountdown();
    this.settings.state = 'idle';
    this.movementLevel = 0;
    const listener = this.motionListener;
    this.motionListener = null;
    if (listener) {
      try {
        await listener.remove();
      } catch {
        this.sensorError = 'The sensor could not be released. Reload the app before arming again.';
      }
    }
    this.changeDetector.markForCheck();
  }

  private clearCountdown(): void {
    if (this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  async testAlarm(): Promise<void> {
    if (this.settings.state !== 'idle' || this.isStoppingAlarm) {
      return;
    }
    if (this.isAndroidApp) {
      try {
        const androidState = await this.nativeAlarm.createTestAlert({ soundEnabled: this.settings.soundEnabled });
        this.showAndroidAlarmState(androidState);
      } catch (error) {
        this.history.storageError = this.errorMessage(error, 'Could not create the Android test alert.');
        this.changeDetector.markForCheck();
        return;
      }
    } else if (this.settings.soundEnabled) {
      try {
        await this.alarmSound.prepare();
        this.alarmSound.start(true);
      } catch (error) {
        this.sensorError = this.errorMessage(error, 'The test alarm sound could not start.');
      }
    }
    this.feedback = 'Test alarm started. No alert was saved.';
    await this.vibratePhone();
    this.changeDetector.markForCheck();
  }

  private async vibratePhone(): Promise<void> {
    if (!this.settings.vibrationEnabled) {
      return;
    }
    try {
      await Haptics.vibrate({ duration: 1000 });
    } catch {
      if (this.feedback) {
        this.feedback += ' Vibration is unavailable on this device.';
      } else {
        this.feedback = 'Movement detected, but vibration is unavailable on this device.';
      }
      this.changeDetector.markForCheck();
    }
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (this.isAndroidApp) {
      if (!document.hidden) {
        void this.readAndroidAlarmState();
      }
      return;
    }
    if (document.hidden) {
      if (this.settings.state === 'idle') {
        this.alarmSound.stop();
      } else {
        void this.stopAlarm();
        this.sensorError = 'Monitoring stopped when the app left the screen. Keep MotionAlarm open and arm again.';
        this.changeDetector.markForCheck();
      }
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.alarmSound.dispose();
    if (this.nativeListener) {
      void this.nativeListener.remove();
    }
    if (!this.isAndroidApp) {
      void this.stopAlarm();
    }
  }
}
