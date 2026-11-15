import { TestBed } from '@angular/core/testing';

import { AlarmSettingsService } from './alarm-settings.service';

describe('AlarmSettingsService', () => {
  let service: AlarmSettingsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AlarmSettingsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
