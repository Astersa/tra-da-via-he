// Bong bóng chat trên đầu avatar. Chỉ import kiểu của Phaser để module test được không cần canvas.
import type Phaser from 'phaser';

export const BUBBLE_MS = 4000;
const MAX_CHARS = 80;
const OFFSET_Y = 40;
const DEPTH = 12;
const STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: '"Be Vietnam Pro", sans-serif',
  fontSize: '12px',
  color: '#482818',
  backgroundColor: '#F8E8D8',
  padding: { x: 6, y: 4 },
  wordWrap: { width: 160, useAdvancedWrap: true },
  align: 'center',
};

interface Bubble {
  text: Phaser.GameObjects.Text;
  timer: Phaser.Time.TimerEvent;
}

export type PositionOf = (userId: string) => { x: number; y: number } | null;

// Mỗi người chơi có tối đa một bong bóng: tin mới thay tin cũ. Hết 4 giây hoặc người đó rời đi thì bong bóng bị hủy.
export class ChatBubbles {
  private readonly items = new Map<string, Bubble>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly positionOf: PositionOf,
  ) {}

  show(userId: string, text: string): void {
    this.remove(userId);
    const pos = this.positionOf(userId);
    if (!pos) return;
    const obj = this.scene.add
      .text(pos.x, pos.y - OFFSET_Y, clip(text), STYLE)
      .setOrigin(0.5, 1)
      .setDepth(DEPTH);
    const timer = this.scene.time.delayedCall(BUBBLE_MS, () => this.remove(userId));
    this.items.set(userId, { text: obj, timer });
  }

  // Gọi mỗi khung hình: đặt bong bóng theo vị trí hiện tại; người không còn trong world thì hủy.
  update(): void {
    // Xóa phần tử đang duyệt trong Map là an toàn.
    for (const [userId, bubble] of this.items) {
      const pos = this.positionOf(userId);
      if (!pos) {
        this.remove(userId);
        continue;
      }
      bubble.text.setPosition(pos.x, pos.y - OFFSET_Y);
    }
  }

  destroy(): void {
    for (const userId of this.items.keys()) this.remove(userId);
  }

  private remove(userId: string): void {
    const bubble = this.items.get(userId);
    if (!bubble) return;
    this.items.delete(userId);
    bubble.timer.remove(false);
    bubble.text.destroy();
  }
}

// Cắt theo ký tự (không cắt giữa chữ có dấu) để bong bóng không quá dài.
export function clip(text: string): string {
  const chars = Array.from(text);
  return chars.length > MAX_CHARS ? `${chars.slice(0, MAX_CHARS).join('')}…` : text;
}
