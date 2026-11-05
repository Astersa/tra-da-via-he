import { useConnectivityStore } from '../store/connectivityStore';
import { API_BASE } from './client';

// Chờ service thức (§3.10.6): gọi GET /api/v1/health mỗi 5 giây, tối đa 180 giây.
// Chỉ một vòng chờ chạy tại một thời điểm: gọi lần hai khi đang chờ thì nhận lại cùng một promise.
// Trả true khi service đã trả lời; false khi quá 180 giây (đặt gaveUp để hiện nút "Thử lại").
const POLL_MS = 5000;
const GIVE_UP_MS = 180_000;

let inflight: Promise<boolean> | null = null;

export function waitUntilAwake(): Promise<boolean> {
  if (!inflight) {
    inflight = runWait().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

function runWait(): Promise<boolean> {
  const store = useConnectivityStore.getState();
  store.markWaking();
  useConnectivityStore.setState({ gaveUp: false });
  return new Promise<boolean>((resolve) => {
    let done = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (awake: boolean): void => {
      if (done) return;
      done = true;
      if (pollTimer !== null) clearTimeout(pollTimer);
      clearTimeout(deadline);
      if (awake) useConnectivityStore.getState().markOk();
      else useConnectivityStore.getState().markGaveUp();
      resolve(awake);
    };

    const deadline = setTimeout(() => finish(false), GIVE_UP_MS);

    // Một request mỗi lượt; lượt sau chỉ lên lịch khi lượt này xong. Lỗi mạng hoặc 5xx chỉ là "chưa thức".
    const poll = async (): Promise<void> => {
      if (done) return;
      try {
        const res = await fetch(`${API_BASE}/health`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'include',
        });
        if (res.ok) {
          finish(true);
          return;
        }
      } catch {
        // Chưa nối được: thử lại ở lượt sau.
      }
      if (!done) pollTimer = setTimeout(() => void poll(), POLL_MS);
    };

    void poll();
  });
}
