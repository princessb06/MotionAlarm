import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { IonApp, IonRouterOutlet, NavController } from '@ionic/angular';

import { AuthService } from './services/auth/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  private auth = inject(AuthService);
  private navigation = inject(NavController);

  constructor() {
    effect(() => {
      if (!this.auth.user()) {
        void this.navigation.navigateRoot('/login');
      }
    });
  }
}
