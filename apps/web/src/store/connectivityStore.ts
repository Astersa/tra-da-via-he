import { create } from 'zustand';

// Trạng thái kết nối tới service (§3.10.6). 'waking': service đang ngủ hoặc khởi động lại, chờ tự về 'ok'.
// gaveUp: đã chờ quá 180 giây mà chưa thấy service; màn chờ hiện nút "Thử lại".
export interface ConnectivityState {
  status: 'ok' | 'waking';
  since: number | null;
  gaveUp: boolean;
  markWaking: () => void;
  markOk: () => void;
  markGaveUp: () => void;
}

export const useConnectivityStore = create<ConnectivityState>()((set, get) => ({
  status: 'ok',
  since: null,
  gaveUp: false,
  markWaking: () => {
    if (get().status === 'waking') return;
    set({ status: 'waking', since: Date.now() });
  },
  markOk: () => {
    if (get().status === 'ok' && !get().gaveUp) return;
    set({ status: 'ok', since: null, gaveUp: false });
  },
  markGaveUp: () => set({ gaveUp: true }),
}));
