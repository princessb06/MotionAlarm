import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton, IonContent, NavController } from '@ionic/angular';

import { AuthService, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, authErrorMessage } from '../services/auth/auth.service';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  imports: [FormsModule, IonButton, IonContent],
})
export class LoginPage {
  auth = inject(AuthService);
  mode: 'login' | 'register' = 'login';
  email = '';
  password = '';
  confirmPassword = '';
  passwordType: 'password' | 'text' = 'password';
  isSubmitting = false;
  error = '';
  readonly minPasswordLength = MIN_PASSWORD_LENGTH;
  readonly maxPasswordLength = MAX_PASSWORD_LENGTH;
  private navigation = inject(NavController);
  private changeDetector = inject(ChangeDetectorRef);

  ionViewWillEnter(): void {
    this.passwordType = 'password';
    if (this.auth.user()) {
      void this.navigation.navigateRoot('/home');
    }
  }

  switchForm(mode: 'login' | 'register'): void {
    this.mode = mode;
    this.password = '';
    this.confirmPassword = '';
    this.passwordType = 'password';
    this.error = '';
  }

  togglePassword(): void {
    if (this.passwordType === 'password') {
      this.passwordType = 'text';
    } else {
      this.passwordType = 'password';
    }
  }

  async submitForm(): Promise<void> {
    if (this.isSubmitting) {
      return;
    }

    this.error = '';
    if (this.mode === 'register' && this.password !== this.confirmPassword) {
      this.error = 'Passwords do not match.';
      return;
    }

    this.isSubmitting = true;
    try {
      if (this.mode === 'register') {
        await this.auth.register(this.email, this.password);
      } else {
        await this.auth.login(this.email, this.password);
      }
      this.password = '';
      this.confirmPassword = '';
      this.passwordType = 'password';
      this.changeDetector.markForCheck();
      await this.navigation.navigateRoot('/home');
    } catch (error) {
      this.error = authErrorMessage(error);
    } finally {
      this.isSubmitting = false;
      this.changeDetector.markForCheck();
    }
  }
}
