// Giữ service thức khi người chơi ngồi yên (§3.10.6): gửi world:ping mỗi 5 phút.
// Chỉ gửi khi socket đang nối VÀ tab đang hiển thị. Tab ẩn thì dừng chu kỳ; tab hiện lại thì đặt lại chu kỳ.
// Không ngắt socket khi tab ẩn (I12): việc đó chưa được quyết định.
// Không dùng pinger ngoài.

export interface KeepAwakeSocket {
  readonly connected: boolean;
  emit(event: 'world:ping', req: Record<string, never>, ack: (res: unknown) => void): unknown;
}

export interface KeepAwakeOpts {
  intervalMs: number;
  isVisible: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

// Trả hàm dừng: hủy timer và gỡ listener visibilitychange. Gọi khi rời, đăng xuất, unmount.
export function startKeepAwake(socket: KeepAwakeSocket, opts: KeepAwakeOpts): () => void {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let handle: unknown = null;
  let stopped = false;

  const clear = (): void => {
    if (handle !== null) clearTimer(handle);
    handle = null;
  };

  const schedule = (): void => {
    clear();
    if (stopped || !opts.isVisible()) return;
    handle = setTimer(tick, opts.intervalMs);
  };

  function tick(): void {
    handle = null;
    if (stopped || !opts.isVisible()) return;
    if (socket.connected) socket.emit('world:ping', {}, () => undefined);
    schedule();
  }

  const onVisibility = (): void => {
    // Tab hiện lại: chu kỳ bắt đầu lại từ đầu. Tab ẩn: schedule() không đặt timer.
    schedule();
  };

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  schedule();

  return () => {
    stopped = true;
    clear();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}
