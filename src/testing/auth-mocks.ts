import { signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { vi } from 'vitest';

import type { AccountUser } from '../app/services/auth/auth.service';

export function mockAuth(uid = 'user-a'): {
  user: WritableSignal<AccountUser | null>;
  error: WritableSignal<string>;
  login: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  getAccessToken: ReturnType<typeof vi.fn>;
  expireLogin: ReturnType<typeof vi.fn>;
} {
  return {
    user: signal<AccountUser | null>({ uid, email: uid + '@example.com' }),
    error: signal(''),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('test-token'),
    expireLogin: vi.fn(),
  };
}
