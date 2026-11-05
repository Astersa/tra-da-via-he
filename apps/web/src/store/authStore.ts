import type { GuestReq, LoginReq, UpgradeReq } from '@tdvh/shared';
import { create } from 'zustand';
import { authApi } from '../api/auth';
import type { ProfileView, UserView } from '../api/types';
import {
  ApiError,
  onSessionLost,
  onTokenChange,
  refreshSession,
  setAccessToken,
} from '../api/client';

export type AuthStatus = 'booting' | 'anonymous' | 'signed-in' | 'boot-error';

export interface AuthState {
  status: AuthStatus;
  user: UserView | null;
  profile: ProfileView | null;
  accessToken: string | null;
  enterAsGuest: (req: GuestReq) => Promise<void>;
  login: (req: LoginReq) => Promise<void>;
  upgrade: (req: UpgradeReq) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => {
  // Sau khi có token mới thì lấy hồ sơ từ /me, đặt trạng thái đã vào quán.
  async function completeSignIn(auth: { accessToken: string }): Promise<void> {
    setAccessToken(auth.accessToken);
    const me = await authApi.me();
    set({ status: 'signed-in', user: me.user, profile: me.profile });
  }

  return {
    status: 'booting',
    user: null,
    profile: null,
    accessToken: null,

    enterAsGuest: (req) => authApi.guest(req).then(completeSignIn),
    login: (req) => authApi.login(req).then(completeSignIn),
    upgrade: (req) => authApi.upgrade(req).then(completeSignIn),

    logout: async () => {
      try {
        await authApi.logout();
      } catch {
        // Dù server lỗi vẫn đăng xuất phía client.
      }
      setAccessToken(null);
      set({ status: 'anonymous', user: null, profile: null });
    },

    bootstrap: async () => {
      set({ status: 'booting' });
      try {
        const hasSession = await refreshSession(null);
        if (!hasSession) {
          set({ status: 'anonymous' });
          return;
        }
        const me = await authApi.me();
        set({ status: 'signed-in', user: me.user, profile: me.profile });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
          set({ status: 'anonymous', user: null, profile: null });
        } else {
          set({ status: 'boot-error' });
        }
      }
    },
  };
});

onTokenChange((token) => useAuthStore.setState({ accessToken: token }));
onSessionLost(() => useAuthStore.setState({ status: 'anonymous', user: null, profile: null }));
