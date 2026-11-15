import { TestBed } from '@angular/core/testing';

import { NATIVE_ALARM } from '../../home/native-alarm';

import { AlertHistoryService } from './alert-history.service';

describe('AlertHistoryService', () => {
  let service: AlertHistoryService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: NATIVE_ALARM, useValue: {} }],
    });
    service = TestBed.inject(AlertHistoryService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
