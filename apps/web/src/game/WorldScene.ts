import Phaser from 'phaser';
import { AvatarIdSchema, getSeats, street01Map, type PlayerView } from '@tdvh/shared';
import { useWorldStore } from '../store/worldStore';
import { DEFAULT_AVATAR, SIT_COLUMN, WALK_COLUMNS, WALK_FRAME_MS, frameFor } from './avatar';
import { bridge } from './bridge';
import { RemotePlayers } from './RemotePlayers';
import { seatPrompt } from './remote';
import {
  dirFromVector,
  nextPosition,
  roundPoint,
  shouldSendMove,
  vectorFromKeys,
  vectorTo,
  type Dir,
  type Pos,
  type SentState,
  type Vec,
} from './movement';

const MAP_KEY = 'street-01';
const SEATS = getSeats(street01Map);

interface KeyMap {
  W: Phaser.Input.Keyboard.Key;
  A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key;
  D: Phaser.Input.Keyboard.Key;
  UP: Phaser.Input.Keyboard.Key;
  DOWN: Phaser.Input.Keyboard.Key;
  LEFT: Phaser.Input.Keyboard.Key;
  RIGHT: Phaser.Input.Keyboard.Key;
}

// Đang gõ trong ô HTML (chat sau này) thì không nhận phím di chuyển.
function isTypingInField(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export class WorldScene extends Phaser.Scene {
  static readonly KEY = 'WorldScene';

  private map!: Phaser.Tilemaps.Tilemap;
  private keys!: KeyMap;
  private avatar: Phaser.GameObjects.Sprite | null = null;
  private avatarId = DEFAULT_AVATAR;
  private pos: Pos = { x: 0, y: 0 };
  private dir: Dir = 'down';
  private target: Pos | null = null;
  // Trạng thái đã gửi (làm tròn). null nghĩa là chưa có vị trí từ server.
  private sent: SentState | null = null;
  private seq = 0;
  private walkClock = 0;
  private unsubscribeSync: (() => void) | null = null;
  private unsubscribePlayers: (() => void) | null = null;
  private remotes!: RemotePlayers;
  private prompt: Phaser.GameObjects.Text | null = null;

  constructor() {
    super({ key: WorldScene.KEY });
  }

  create(): void {
    const data = structuredClone(street01Map);
    this.cache.tilemap.add(MAP_KEY, { format: Phaser.Tilemaps.Formats.TILED_JSON, data });
    this.map = this.make.tilemap({ key: MAP_KEY });
    const tileset = this.map.addTilesetImage('street', 'street');
    if (!tileset) throw new Error('thiếu tileset street');
    // Chỉ vẽ lớp ground. Lớp collision chỉ dùng cho isWalkable.
    this.map.createLayer('ground', tileset, 0, 0);

    this.cameras.main.setBounds(0, 0, this.map.widthInPixels, this.map.heightInPixels);
    this.cameras.main.setZoom(1.5);

    // addKeys(..., false): không chặn phím mặc định, để ô chat vẫn gõ được.
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as unknown as KeyMap;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.target = { x: p.worldX, y: p.worldY };
    });

    this.unsubscribeSync = bridge.on('world:position-sync', (p) => this.applySync(p));
    this.remotes = new RemotePlayers(this);
    this.remotes.sync(useWorldStore.getState().players);
    this.unsubscribePlayers = useWorldStore.subscribe((st, prev) => {
      if (st.players !== prev.players) this.remotes.sync(st.players);
    });
    this.prompt = this.add
      .text(0, 0, '', { fontFamily: '"Be Vietnam Pro", sans-serif', fontSize: '12px', color: '#482818', stroke: '#F8E8D8', strokeThickness: 3 })
      .setOrigin(0.5, 1)
      .setDepth(11)
      .setVisible(false);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeSync?.();
      this.unsubscribePlayers?.();
      this.remotes.destroy();
    });

    // Đã có vị trí từ trước khi scene sẵn sàng thì dùng luôn.
    const st = useWorldStore.getState();
    if (st.self && st.positionSync > 0) {
      this.applySync({ x: st.self.x, y: st.self.y, dir: st.self.dir, avatarId: st.self.avatarId });
    }
  }

  update(time: number, delta: number): void {
    this.remotes.update(time, delta);
    if (!this.avatar) return;

    let v: Vec = { x: 0, y: 0 };
    const typing = isTypingInField();
    // Đang ngồi thì server không nhận player:move: không đi bằng phím hay click.
    const st = useWorldStore.getState();
    const seated = st.self?.seatId != null;
    if (typing || seated) {
      this.target = null;
    } else {
      const k = this.keys;
      v = vectorFromKeys({
        left: k.A.isDown || k.LEFT.isDown,
        right: k.D.isDown || k.RIGHT.isDown,
        up: k.W.isDown || k.UP.isDown,
        down: k.S.isDown || k.DOWN.isDown,
      });
      if (v.x !== 0 || v.y !== 0) {
        this.target = null;
      } else if (this.target) {
        v = vectorTo(this.pos, this.target);
        if (v.x === 0 && v.y === 0) this.target = null;
      }
    }

    const next = nextPosition(street01Map, this.pos, v, delta);
    const moved = next.x !== this.pos.x || next.y !== this.pos.y;
    // Click-to-move bị tường chặn thì bỏ điểm đích, không đứng đẩy mãi.
    if (!moved && this.target && (v.x !== 0 || v.y !== 0)) this.target = null;
    this.pos = next;
    if (v.x !== 0 || v.y !== 0) this.dir = dirFromVector(v, this.dir);

    this.avatar.setPosition(this.pos.x, this.pos.y);
    this.updateFrame(moved, delta);
    this.updatePrompt(st);
    this.syncToServer(time);
  }

  // Gợi ý E: Ngồi / E: Đứng trên đầu avatar mình. Chỉ đổi text khi nội dung đổi.
  private updatePrompt(st: ReturnType<typeof useWorldStore.getState>): void {
    if (!this.prompt) return;
    const text = seatPrompt(st.self, this.pos, SEATS, st.takenSeats);
    if (text === null) {
      this.prompt.setVisible(false);
      return;
    }
    if (this.prompt.text !== text) this.prompt.setText(text);
    this.prompt.setPosition(this.pos.x, this.pos.y - 30).setVisible(true);
  }

  // Đặt lại vị trí từ server (đầu phiên hoặc bị sửa). Đây là nguồn sự thật, bỏ dự đoán cũ.
  private applySync(p: { x: number; y: number; dir: PlayerView['dir']; avatarId: string }): void {
    this.avatarId = AvatarIdSchema.safeParse(p.avatarId).success ? p.avatarId : DEFAULT_AVATAR;
    this.pos = { x: p.x, y: p.y };
    this.dir = p.dir;
    this.target = null;
    const r = roundPoint(this.pos);
    this.sent = { ...r, dir: this.dir, at: -Infinity };

    if (!this.avatar) {
      this.avatar = this.add.sprite(p.x, p.y, this.avatarId, frameFor(this.dir, 0)).setDepth(10);
      this.cameras.main.startFollow(this.avatar, true);
    } else {
      this.avatar.setTexture(this.avatarId, frameFor(this.dir, 0)).setPosition(p.x, p.y);
    }
  }

  private updateFrame(moved: boolean, delta: number): void {
    if (!this.avatar) return;
    if (moved) this.walkClock += delta;
    else this.walkClock = 0;
    const step = Math.floor(this.walkClock / WALK_FRAME_MS) % WALK_COLUMNS.length;
    const seated = useWorldStore.getState().self?.seatId != null;
    const col = seated ? SIT_COLUMN : moved ? WALK_COLUMNS[step]! : 0;
    this.avatar.setFrame(frameFor(this.dir, col));
  }

  // Gửi player:move khi vị trí làm tròn hoặc hướng đổi, và đủ nhịp tối thiểu.
  private syncToServer(now: number): void {
    if (!this.sent) return;
    const r = roundPoint(this.pos);
    const next = { ...r, dir: this.dir };
    if (!shouldSendMove(this.sent, next, now)) return;
    const seq = this.seq + 1;
    if (useWorldStore.getState().sendMove({ x: r.x, y: r.y, dir: this.dir, seq })) {
      this.seq = seq;
      this.sent = { ...next, at: now };
    }
  }
}
