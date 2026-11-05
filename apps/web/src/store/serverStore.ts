import { ListServersResSchema, QuickJoinResSchema } from '@tdvh/shared';
import { create } from 'zustand';
import { request } from '../api/client';

// Kiểu suy từ schema shared, cùng cách với api/types.ts (không kéo zod vào apps/web).
export type ServerCard = ReturnType<typeof ListServersResSchema.parse>['items'][number];

export interface ServerState {
  // null nghĩa là chưa tải lần nào.
  servers: ServerCard[] | null;
  loading: boolean;
  listError: unknown | null;
  joining: boolean;
  joinError: unknown | null;
  // Chỉ lưu id server đã chọn; socket và màn game sẽ dùng ở task sau.
  serverId: string | null;
  loadServers: () => Promise<void>;
  quickJoin: () => Promise<void>;
  selectServer: (serverId: string) => void;
}

export const useServerStore = create<ServerState>()((set, get) => ({
  servers: null,
  loading: false,
  listError: null,
  joining: false,
  joinError: null,
  serverId: null,

  loadServers: async () => {
    if (get().loading) return;
    set({ loading: true, listError: null });
    try {
      const res = await request('/servers', { schema: ListServersResSchema });
      set({ servers: res.items, loading: false });
    } catch (err) {
      set({ loading: false, listError: err });
    }
  },

  quickJoin: async () => {
    if (get().joining) return;
    set({ joining: true, joinError: null });
    try {
      const res = await request('/servers/quick-join', { method: 'POST', schema: QuickJoinResSchema });
      set({ joining: false, serverId: res.serverId });
    } catch (err) {
      set({ joining: false, joinError: err });
    }
  },

  selectServer: (serverId) => set({ serverId, joinError: null }),
}));
