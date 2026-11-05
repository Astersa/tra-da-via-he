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

// Yêu cầu mở form tạo tài khoản. onSuccess chạy sau khi nâng cấp xong; onCancel khi người chơi đóng form.
export interface UpgradeRequest {
  reason?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export interface AuthState {
  status: AuthStatus;
  user: UserView | null;
  profile: ProfileView | null;
  accessToken: string | null;
  upgradeRequest: UpgradeRequest | null;
  enterAsGuest: (req: GuestReq) => Promise<void>;
  login: (req: LoginReq) => Promise<void>;
  upgrade: (req: UpgradeReq) => Promise<void>;
  openUpgrade: (req: UpgradeRequest) => void;
  closeUpgrade: () => void;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set, get) => {
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
    upgradeRequest: null,

    enterAsGuest: (req) => authApi.guest(req).then(completeSignIn),
    login: (req) => authApi.login(req).then(completeSignIn),
    // Giữ nguyên socket: chỉ cập nhật user (kind, username) và token; world store không bị đụng tới.
    upgrade: (req) => authApi.upgrade(req).then(completeSignIn),

    // Mở form tạo tài khoản. Nếu đang có yêu cầu khác thì đóng yêu cầu cũ như bị hủy.
    openUpgrade: (req) => {
      const prev = get().upgradeRequest;
      if (prev) prev.onCancel?.();
      set({ upgradeRequest: req });
    },
    closeUpgrade: () => set({ upgradeRequest: null }),

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

// Tiện cho M4-E3-T1: openUpgrade({reason, onSuccess}) từ bất kỳ đâu, không cần hook.
export function openUpgrade(req: UpgradeRequest): void {
  useAuthStore.getState().openUpgrade(req);
}

onTokenChange((token) => useAuthStore.setState({ accessToken: token }));
onSessionLost(() => useAuthStore.setState({ status: 'anonymous', user: null, profile: null }));
