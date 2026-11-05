import {
  AuthResSchema,
  MeResSchema,
  type GuestReq,
  type LoginReq,
  type UpgradeReq,
} from '@tdvh/shared';
import { request } from './client';

// Các endpoint auth và /me theo §3.3.
export const authApi = {
  guest: (req: GuestReq) =>
    request('/auth/guest', { method: 'POST', body: req, schema: AuthResSchema }),
  login: (req: LoginReq) =>
    request('/auth/login', { method: 'POST', body: req, schema: AuthResSchema }),
  upgrade: (req: UpgradeReq) =>
    request('/auth/upgrade', { method: 'POST', body: req, schema: AuthResSchema }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/me', { schema: MeResSchema }),
};
