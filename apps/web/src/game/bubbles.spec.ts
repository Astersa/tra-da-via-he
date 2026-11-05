import type Phaser from 'phaser';
import { describe, expect, it } from 'vitest';
import { BUBBLE_MS, ChatBubbles, clip } from './bubbles';

interface FakeText {
  x: number;
  y: number;
  text: string;
  destroyed: boolean;
  setOrigin(): FakeText;
  setDepth(): FakeText;
  setPosition(x: number, y: number): FakeText;
  destroy(): void;
}
interface FakeTimer {
  ms: number;
  cb: () => void;
  removed: boolean;
  remove(dispatch?: boolean): void;
}

function fakeScene() {
  const texts: FakeText[] = [];
  const timers: FakeTimer[] = [];
  const scene = {
    add: {
      text(x: number, y: number, text: string): FakeText {
        const t: FakeText = {
          x,
          y,
          text,
          destroyed: false,
          setOrigin() {
            return this;
          },
          setDepth() {
            return this;
          },
          setPosition(nx, ny) {
            this.x = nx;
            this.y = ny;
            return this;
          },
          destroy() {
            this.destroyed = true;
          },
        };
        texts.push(t);
        return t;
      },
    },
    time: {
      delayedCall(ms: number, cb: () => void): FakeTimer {
        const t: FakeTimer = {
          ms,
          cb,
          removed: false,
          remove() {
            this.removed = true;
          },
        };
        timers.push(t);
        return t;
      },
    },
  };
  return { scene: scene as unknown as Phaser.Scene, texts, timers };
}

function setup() {
  const positions: Record<string, { x: number; y: number }> = { A: { x: 100, y: 200 } };
  const f = fakeScene();
  const bubbles = new ChatBubbles(f.scene, (id) => positions[id] ?? null);
  return { ...f, bubbles, positions };
}

describe('ChatBubbles', () => {
  it('hiện bong bóng phía trên avatar và hết 4 giây thì hủy', () => {
    const { bubbles, texts, timers } = setup();
    bubbles.show('A', 'xin chào');
    expect(texts).toHaveLength(1);
    expect(texts[0]!.text).toBe('xin chào');
    expect(texts[0]!.y).toBeLessThan(200);
    expect(timers[0]!.ms).toBe(BUBBLE_MS);
    expect(BUBBLE_MS).toBe(4000);

    timers[0]!.cb();
    expect(texts[0]!.destroyed).toBe(true);
  });

  it('tin mới của cùng người thay bong bóng cũ, không còn hai object', () => {
    const { bubbles, texts, timers } = setup();
    bubbles.show('A', 'một');
    bubbles.show('A', 'hai');
    expect(texts[0]!.destroyed).toBe(true);
    expect(timers[0]!.removed).toBe(true);
    expect(texts.filter((t) => !t.destroyed)).toHaveLength(1);
    expect(texts[1]!.text).toBe('hai');
  });

  it('bong bóng theo vị trí; người rời world thì bong bóng bị hủy', () => {
    const { bubbles, texts, positions } = setup();
    bubbles.show('A', 'chào');
    positions.A = { x: 150, y: 260 };
    bubbles.update();
    expect(texts[0]!.x).toBe(150);
    expect(texts[0]!.y).toBeLessThan(260);

    delete positions.A;
    bubbles.update();
    expect(texts[0]!.destroyed).toBe(true);
  });

  it('người không có vị trí thì không tạo bong bóng', () => {
    const { bubbles, texts } = setup();
    bubbles.show('Z', 'ai đó');
    expect(texts).toHaveLength(0);
  });

  it('destroy hủy mọi bong bóng và timer', () => {
    const { bubbles, texts, timers, positions } = setup();
    positions.B = { x: 1, y: 1 };
    bubbles.show('A', 'một');
    bubbles.show('B', 'hai');
    bubbles.destroy();
    expect(texts.every((t) => t.destroyed)).toBe(true);
    expect(timers.every((t) => t.removed)).toBe(true);
  });

  it('clip cắt theo ký tự, không cắt giữa chữ có dấu', () => {
    const long = 'ắ'.repeat(100);
    const out = clip(long);
    expect(Array.from(out)).toHaveLength(81);
    expect(out.endsWith('…')).toBe(true);
    expect(clip('Trà đá')).toBe('Trà đá');
  });
});
