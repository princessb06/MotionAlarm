import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import type { OnDestroy } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export type ThemeMode = 'light' | 'dark';

const storageKey = 'motion-alarm-theme';

@Injectable({
  providedIn: 'root',
})
export class ThemeService implements OnDestroy {
  private document = inject(DOCUMENT);
  private window = this.document.defaultView;
  private selectedTheme = signal(this.readSavedTheme());
  readonly currentTheme = this.selectedTheme.asReadonly();

  private reloadSavedTheme = (event: StorageEvent): void => {
    if (event.key === storageKey || event.key === null) {
      const theme = this.readSavedTheme();
      this.selectedTheme.set(theme);
      this.applyTheme(theme);
    }
  };

  constructor() {
    this.applyTheme(this.currentTheme());
    this.window?.addEventListener('storage', this.reloadSavedTheme);
  }

  setTheme(theme: ThemeMode): void {
    this.selectedTheme.set(theme);
    this.applyTheme(theme);

    try {
      this.window?.localStorage.setItem(storageKey, theme);
    } catch {
      return;
    }
  }

  private readSavedTheme(): ThemeMode {
    try {
      const savedTheme = this.window?.localStorage.getItem(storageKey);
      if (savedTheme === 'light') {
        return 'light';
      }
    } catch {
      return 'dark';
    }
    return 'dark';
  }

  private applyTheme(theme: ThemeMode): void {
    let backgroundColor = '#141d18';
    let statusBarStyle = Style.Dark;
    if (theme === 'light') {
      backgroundColor = '#f6f8f5';
      statusBarStyle = Style.Light;
    }

    this.document.documentElement.dataset['theme'] = theme;
    this.document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
    this.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgroundColor);

    if (Capacitor.isNativePlatform()) {
      void StatusBar.setStyle({ style: statusBarStyle }).catch(() => undefined);
    }
  }

  ngOnDestroy(): void {
    this.window?.removeEventListener('storage', this.reloadSavedTheme);
  }
}
