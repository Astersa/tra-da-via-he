import { useEffect, useRef } from 'react';
import { useWorldStore } from '../store/worldStore';
import { bridge } from './bridge';
import { createGame } from './createGame';
import './GameView.css';

// Màn chơi: tạo Phaser một lần cho mỗi máy chủ, hủy khi unmount hoặc khi đổi máy chủ (kể cả StrictMode chạy effect hai lần).
// Đổi máy chủ hủy game cũ để người chơi, chat bong bóng và sprite của server cũ không còn trong scene mới (§3.5.3, M1-E5-T10).
export function GameView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const status = useWorldStore((s) => s.status);
  const error = useWorldStore((s) => s.error);
  const serverId = useWorldStore((s) => s.serverId);
  const connect = useWorldStore((s) => s.connect);
  const disconnectWorld = useWorldStore((s) => s.disconnectWorld);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const game = createGame(host);
    // Vị trí đặt lại từ server: báo cho scene. Scene tự đọc store khi khởi tạo.
    const unsubscribe = useWorldStore.subscribe((st, prev) => {
      if (st.positionSync === prev.positionSync || !st.self) return;
      bridge.emit('world:position-sync', {
        x: st.self.x,
        y: st.self.y,
        dir: st.self.dir,
        avatarId: st.self.avatarId,
      });
    });
    return () => {
      unsubscribe();
      // Phaser hủy ở khung hình kế tiếp nên canvas cũ có thể còn trong DOM; xóa luôn để không có hai canvas.
      game.destroy(true);
      host.replaceChildren();
    };
  }, [serverId]);

  let message: string | null = null;
  let action: { label: string; onClick: () => void } | null = null;
  if (status === 'connecting') {
    message = 'Đang vào quán...';
  } else if (status === 'reconnecting') {
    message = 'Mất kết nối, đang nối lại...';
  } else if (status === 'replaced') {
    message = 'Tài khoản đang chơi ở tab khác.';
    action = serverId ? { label: 'Chơi ở tab này', onClick: () => connect(serverId) } : null;
  } else if (status === 'disconnected') {
    message = 'Đã mất kết nối tới máy chủ.';
  } else if (status === 'error') {
    message = error?.message ?? 'Có lỗi khi vào quán.';
  }
  if (message !== null && action === null && status !== 'connecting' && status !== 'reconnecting') {
    action = { label: 'Về màn chọn máy chủ', onClick: () => disconnectWorld() };
  }

  return (
    <main className="game-screen">
      <div ref={hostRef} className="game-host" />
      {message !== null && (
        <div className="game-overlay" role="status">
          <p>{message}</p>
          {action && (
            <button type="button" className="game-overlay-button" onClick={action.onClick}>
              {action.label}
            </button>
          )}
        </div>
      )}
    </main>
  );
}
