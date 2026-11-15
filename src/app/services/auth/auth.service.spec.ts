import { TestBed } from '@angular/core/testing';

import { NATIVE_ALARM } from '../../home/native-alarm';

import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: NATIVE_ALARM, useValue: {} }],
    });
    service = TestBed.inject(AuthService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
