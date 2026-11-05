// Cầu nối React -> Phaser (§3.1): React không gọi thẳng scene, chỉ phát sự kiện.
// Dữ liệu thật vẫn nằm ở worldStore; sự kiện chỉ báo "có chuyện xảy ra".
import Phaser from 'phaser';
import type { PlayerView } from '@tdvh/shared';

export interface BridgeEvents {
  // Vị trí của mình vừa được đặt lại từ server (đầu phiên hoặc bị server sửa).
  'world:position-sync': { x: number; y: number; dir: PlayerView['dir']; avatarId: string };
}

const emitter = new Phaser.Events.EventEmitter();

export const bridge = {
  emit<K extends keyof BridgeEvents>(event: K, payload: BridgeEvents[K]): void {
    emitter.emit(event, payload);
  },
  // Trả về hàm hủy đăng ký.
  on<K extends keyof BridgeEvents>(event: K, fn: (payload: BridgeEvents[K]) => void): () => void {
    emitter.on(event, fn);
    return () => {
      emitter.off(event, fn);
    };
  },
};
