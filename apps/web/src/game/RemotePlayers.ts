// Sprite và nhãn tên của người chơi khác. Vị trí lấy từ store, nội suy bằng remote.ts.
import Phaser from 'phaser';
import { AvatarIdSchema, type PlayerView } from '@tdvh/shared';
import { DEFAULT_AVATAR, SIT_COLUMN, WALK_COLUMNS, WALK_FRAME_MS, frameFor } from './avatar';
import type { Dir } from './movement';
import {
  DISCONNECTED_ALPHA,
  advance,
  createTrack,
  diffIds,
  positionAt,
  pushTarget,
  shortName,
  type Pos,
  type Track,
} from './remote';

const DEPTH = 9;
const LABEL_OFFSET_Y = 30;
const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: '"Be Vietnam Pro", sans-serif',
  fontSize: '12px',
  color: '#482818',
  stroke: '#F8E8D8',
  strokeThickness: 3,
};

interface Remote {
  avatarId: string;
  track: Track;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  dir: Dir;
  seated: boolean;
  connected: boolean;
  last: Pos;
  walkClock: number;
}

export class RemotePlayers {
  private items = new Map<string, Remote>();

  constructor(private readonly scene: Phaser.Scene) {}

  /** Đồng bộ theo danh sách người chơi trong store: thêm mới, cập nhật vị trí, xóa người đã rời. */
  sync(players: Record<string, PlayerView>): void {
    const now = this.scene.time.now;
    const { removed } = diffIds(this.items.keys(), Object.keys(players));
    for (const id of removed) this.remove(id);
    for (const p of Object.values(players)) {
      const r = this.items.get(p.userId);
      if (!r || r.avatarId !== this.avatarKey(p.avatarId)) {
        if (r) this.remove(p.userId);
        this.add(p, now);
        continue;
      }
      r.track = pushTarget(r.track, { x: p.x, y: p.y }, now);
      r.dir = p.dir;
      r.seated = p.seatId !== null;
      if (r.connected !== p.connected) {
        r.connected = p.connected;
        const alpha = p.connected ? 1 : DISCONNECTED_ALPHA;
        r.sprite.setAlpha(alpha);
        r.label.setAlpha(alpha);
      }
    }
  }

  /** Mỗi khung hình: đẩy nội suy, đổi frame đi bộ hoặc ngồi, dời nhãn theo avatar. */
  update(now: number, delta: number): void {
    for (const r of this.items.values()) {
      r.track = advance(r.track, now);
      const pos = positionAt(r.track, now);
      const moving = pos.x !== r.last.x || pos.y !== r.last.y;
      r.last = pos;
      r.walkClock = moving ? r.walkClock + delta : 0;
      const step = Math.floor(r.walkClock / WALK_FRAME_MS) % WALK_COLUMNS.length;
      const column = r.seated ? SIT_COLUMN : moving ? WALK_COLUMNS[step]! : 0;
      r.sprite.setPosition(pos.x, pos.y).setFrame(frameFor(r.dir, column));
      r.label.setPosition(pos.x, pos.y - LABEL_OFFSET_Y);
    }
  }

  destroy(): void {
    for (const id of [...this.items.keys()]) this.remove(id);
  }

  private avatarKey(avatarId: string): string {
    return AvatarIdSchema.safeParse(avatarId).success && this.scene.textures.exists(avatarId) ? avatarId : DEFAULT_AVATAR;
  }

  private add(p: PlayerView, now: number): void {
    const avatarId = this.avatarKey(p.avatarId);
    const start = { x: p.x, y: p.y };
    const sprite = this.scene.add
      .sprite(p.x, p.y, avatarId, frameFor(p.dir, p.seatId ? SIT_COLUMN : 0))
      .setDepth(DEPTH);
    const label = this.scene.add
      .text(p.x, p.y - LABEL_OFFSET_Y, shortName(p.displayName), LABEL_STYLE)
      .setOrigin(0.5, 1)
      .setDepth(DEPTH + 1);
    const alpha = p.connected ? 1 : DISCONNECTED_ALPHA;
    sprite.setAlpha(alpha);
    label.setAlpha(alpha);
    this.items.set(p.userId, {
      avatarId,
      track: createTrack(start, now),
      sprite,
      label,
      dir: p.dir,
      seated: p.seatId !== null,
      connected: p.connected,
      last: start,
      walkClock: 0,
    });
  }

  private remove(id: string): void {
    const r = this.items.get(id);
    if (!r) return;
    r.sprite.destroy();
    r.label.destroy();
    this.items.delete(id);
  }
}

