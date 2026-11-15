import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { NATIVE_ALARM } from '../home/native-alarm';

import { AlertHistoryPage } from './alert-history.page';

describe('AlertHistoryPage', () => {
  let component: AlertHistoryPage;
  let fixture: ComponentFixture<AlertHistoryPage>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: NATIVE_ALARM, useValue: {} }],
    });
    fixture = TestBed.createComponent(AlertHistoryPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
