import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerView, WorldState } from '@tdvh/shared';
import { useWorldStore } from './worldStore';
import { createSocket, type TypedSocket } from '../socket/createSocket';
import { refreshSession, setAccessToken } from '../api/client';
import { useConnectivityStore } from './connectivityStore';

vi.mock('../socket/createSocket', () => ({ createSocket: vi.fn() }));
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, refreshSession: vi.fn() };
});

const SERVER = '00000000-0000-4000-8000-0000000000a1';
const SESSION = '00000000-0000-4000-8000-0000000000b1';
const USER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

// Socket giả: ghi lại emit, cho phép bắn event và trả ack thủ công.
interface Emitted {
  event: string;
  req: unknown;
  ack?: (res: unknown) => void;
}
class FakeSocket {
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  emitted: Emitted[] = [];
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  on(event: string, fn: (...args: unknown[]) => void): this {
    const list = this.listeners.get(event) ?? [];
    list.push(fn);
    this.listeners.set(event, list);
    return this;
  }
  removeAllListeners(): this {
    this.listeners.clear();
    return this;
  }
  emit(event: string, req: unknown, ack?: (res: unknown) => void): this {
    this.emitted.push({ event, req, ack });
    return this;
  }
  connect(): this {
    this.connectCalls += 1;
    return this;
  }
  disconnect(): this {
    this.connected = false;
    this.disconnectCalls += 1;
    return this;
  }
  fire(event: string, ...args: unknown[]): void {
    if (event === 'connect') this.connected = true;
    if (event === 'disconnect') this.connected = false;
    for (const fn of this.listeners.get(event) ?? []) fn(...args);
  }
  lastEmit(event: string): Emitted {
    const found = this.emitted.filter((e) => e.event === event).at(-1);
    if (!found) throw new Error(`no emit ${event}`);
    return found;
  }
  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }
}

function player(userId: string, displayName: string, x: number, y: number): PlayerView {
  return { userId, displayName, avatarId: 'avatar_01', x, y, dir: 'down', seatId: null, connected: true };
}

function worldState(over: Partial<WorldState> = {}): WorldState {
  return {
    sessionId: SESSION,
    serverId: SERVER,
    self: player(USER, 'Lan', 10, 10),
    players: [player(OTHER, 'Minh', 50, 50)],
    shops: [],
    plots: [],
    takenSeats: [],
    recentChat: [],
    wallet: { balance: '100', held: '0', available: '100', version: 3 },
    myOpenOrders: [],
    staff: null,
    mapVersion: 1,
    ...over,
  };
}

let fake: FakeSocket;

function useFake(): FakeSocket {
  fake = new FakeSocket();
  vi.mocked(createSocket).mockReturnValue(fake as unknown as TypedSocket);
  return fake;
}

async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

// Nối và join thành công; trả về state sau khi joined.
async function joinedWorld(): Promise<void> {
  useWorldStore.getState().connect(SERVER);
  fake.fire('connect');
  fake.connectCalls = 0; // đếm lại từ đây
  fake.lastEmit('world:join').ack?.({ ok: true, data: worldState() });
  await tick();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(refreshSession).mockReset();
  vi.mocked(refreshSession).mockResolvedValue(true);
  vi.mocked(createSocket).mockReset();
  useFake();
  setAccessToken('token-1');
});

afterEach(() => {
  useWorldStore.getState().disconnectWorld();
  vi.useRealTimers();
});

describe('worldStore: join', () => {
  it('gọi world:join với serverId và thay state bằng WorldState khi ack ok', async () => {
    await joinedWorld();
    const st = useWorldStore.getState();
    expect(fake.lastEmit('world:join').req).toEqual({ serverId: SERVER });
    expect(st.status).toBe('joined');
    expect(st.sessionId).toBe(SESSION);
    expect(st.players[OTHER]?.displayName).toBe('Minh');
    expect(st.self?.userId).toBe(USER);
  });

  it('không đưa WorldState sai schema vào store', async () => {
    useWorldStore.getState().connect(SERVER);
    fake.fire('connect');
    fake.lastEmit('world:join').ack?.({ ok: true, data: { nope: true } });
    await tick();
    expect(useWorldStore.getState().status).toBe('error');
    expect(useWorldStore.getState().self).toBeNull();
  });
});

describe('worldStore: reconnect', () => {
  it('mất kết nối vì transport close: refresh một lần, nối lại, world:join kèm resumeSessionId', async () => {
    await joinedWorld();
    fake.fire('disconnect', 'transport close');
    expect(useWorldStore.getState().status).toBe('reconnecting');
    await tick(1000);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fake.connectCalls).toBe(1);

    fake.fire('connect');
    expect(fake.lastEmit('world:join').req).toEqual({ serverId: SERVER, resumeSessionId: SESSION });
    fake.lastEmit('world:join').ack?.({ ok: true, data: worldState({ mapVersion: 7 }) });
    await tick();
    expect(useWorldStore.getState().status).toBe('joined');
    expect(useWorldStore.getState().mapVersion).toBe(7);
  });

  it('không lặp lại timer khi nhiều lần mất kết nối liên tiếp chỉ là một chuỗi', async () => {
    await joinedWorld();
    fake.fire('disconnect', 'ping timeout');
    fake.fire('disconnect', 'transport close');
    await tick(60_000);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('io server disconnect không tự nối lại', async () => {
    await joinedWorld();
    fake.fire('disconnect', 'io server disconnect');
    await tick(60_000);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(fake.connectCalls).toBe(0);
    expect(useWorldStore.getState().status).toBe('disconnected');
  });

  it('refresh thất bại thì đăng xuất (ngắt world, xóa state), không nối lại', async () => {
    await joinedWorld();
    vi.mocked(refreshSession).mockResolvedValueOnce(false);
    fake.fire('disconnect', 'transport close');
    await tick(1000);
    expect(fake.connectCalls).toBe(0);
    expect(useWorldStore.getState().status).toBe('idle');
    expect(useWorldStore.getState().self).toBeNull();
  });
});

describe('worldStore: lỗi auth khi nối', () => {
  it('TOKEN_EXPIRED: refresh đúng một lần rồi nối lại; vẫn bị từ chối thì dừng, không lặp', async () => {
    useWorldStore.getState().connect(SERVER);
    fake.fire('connect_error', new Error('TOKEN_EXPIRED'));
    await tick();
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fake.connectCalls).toBe(2); // lần connect đầu + lần sau refresh

    fake.fire('connect_error', new Error('UNAUTHENTICATED'));
    await tick(60_000);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fake.connectCalls).toBe(2);
    expect(useWorldStore.getState().status).toBe('error');
  });
});

describe('worldStore: session:replaced', () => {
  it('đặt sessionLost, không tự nối lại, và tắt socket cũ', async () => {
    await joinedWorld();
    fake.fire('session:replaced', { reason: 'NEW_TAB' });
    const st = useWorldStore.getState();
    expect(st.sessionLost).toBe(true);
    expect(st.status).toBe('replaced');
    expect(st.replacedReason).toBe('NEW_TAB');
    expect(fake.disconnectCalls).toBeGreaterThan(0);

    fake.fire('disconnect', 'io server disconnect');
    await tick(60_000);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(fake.connectCalls).toBe(0);
  });

  it('connect lại từ tab này dừng hẳn socket cũ (listener và timer đều bị gỡ)', async () => {
    await joinedWorld();
    const first = fake;
    fake.fire('disconnect', 'transport close'); // để lại một timer reconnect
    const second = useFake();
    useWorldStore.getState().connect(SERVER);
    expect(first.listenerCount('connect')).toBe(0);
    await tick(60_000);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(second.connectCalls).toBe(1);
  });
});

describe('worldStore: ví và payload', () => {
  it('wallet:updated cũ bị bỏ, version mới được áp dụng', async () => {
    await joinedWorld();
    fake.fire('wallet:updated', { balance: '50', held: '0', available: '50', version: 2, reason: 'ADMIN_ADJUST' });
    expect(useWorldStore.getState().wallet?.balance).toBe('100');
    fake.fire('wallet:updated', { balance: '70', held: '0', available: '70', version: 4, reason: 'ORDER_CAPTURE' });
    expect(useWorldStore.getState().wallet?.balance).toBe('70');
    fake.fire('wallet:updated', { balance: '1', held: '0', available: '1', version: 4, reason: 'ORDER_CAPTURE' });
    expect(useWorldStore.getState().wallet?.balance).toBe('70');
  });

  it('payload sai schema bị bỏ mà không làm sập store', async () => {
    await joinedWorld();
    const before = useWorldStore.getState().players;
    expect(() => fake.fire('player:moved', { garbage: true })).not.toThrow();
    expect(() => fake.fire('chat:message', { id: 'x', extra: 1 })).not.toThrow();
    expect(useWorldStore.getState().players).toBe(before);
    expect(useWorldStore.getState().recentChat).toHaveLength(0);
  });

  it('sự kiện trước khi có state bị bỏ an toàn', () => {
    fake = useFake();
    useWorldStore.getState().connect(SERVER);
    expect(() => fake.fire('player:joined', player(OTHER, 'Minh', 1, 1))).not.toThrow();
    expect(useWorldStore.getState().players).toEqual({});
  });
});

describe('worldStore: player:moved', () => {
  it('áp dụng cho người khác, bỏ seq cũ, và chỉ áp dụng bản corrected cho mình', async () => {
    await joinedWorld();
    fake.fire('player:moved', {
      moves: [
        { userId: USER, x: 99, y: 99, dir: 'up', seq: 1 },
        { userId: OTHER, x: 60, y: 60, dir: 'left', seq: 5 },
      ],
    });
    expect(useWorldStore.getState().self?.x).toBe(10);
    expect(useWorldStore.getState().players[OTHER]?.x).toBe(60);

    fake.fire('player:moved', { moves: [{ userId: OTHER, x: 1, y: 1, dir: 'up', seq: 4 }] });
    expect(useWorldStore.getState().players[OTHER]?.x).toBe(60);

    fake.fire('player:moved', { moves: [{ userId: USER, x: 12, y: 13, dir: 'up', seq: 2, corrected: true }] });
    expect(useWorldStore.getState().self).toMatchObject({ x: 12, y: 13, dir: 'up' });
  });

  it('player:left gỡ người chơi khỏi store', async () => {
    await joinedWorld();
    fake.fire('player:left', { userId: OTHER, reason: 'LEFT' });
    expect(useWorldStore.getState().players[OTHER]).toBeUndefined();
  });
});

describe('worldStore: đăng xuất', () => {
  it('token về null thì ngắt socket, xóa world store và không còn timer', async () => {
    await joinedWorld();
    fake.fire('disconnect', 'transport close');
    setAccessToken(null);
    expect(fake.disconnectCalls).toBeGreaterThan(0);
    expect(useWorldStore.getState().status).toBe('idle');
    expect(useWorldStore.getState().self).toBeNull();
    await tick(60_000);
    expect(refreshSession).not.toHaveBeenCalled();
  });
});

describe('worldStore: ngồi và đứng', () => {
  const SEAT = 'P2-S3';

  it('sitSeat gửi player:sit và cập nhật ghế của mình khi ack ok', async () => {
    await joinedWorld();
    const p = useWorldStore.getState().sitSeat(SEAT);
    expect(fake.lastEmit('player:sit').req).toEqual({ seatId: SEAT });
    fake.lastEmit('player:sit').ack?.({ ok: true, data: { seatId: SEAT } });
    await expect(p).resolves.toBe(true);
    const st = useWorldStore.getState();
    expect(st.self?.seatId).toBe(SEAT);
    expect(st.takenSeats[SEAT]).toBe(USER);
  });

  it('SEAT_TAKEN hoặc TOO_FAR: giữ ghế cũ, đặt actionError bằng message của server', async () => {
    await joinedWorld();
    const p = useWorldStore.getState().sitSeat(SEAT);
    fake.lastEmit('player:sit').ack?.({ ok: false, error: { code: 'TOO_FAR', message: 'Quá xa ghế', retryable: false } });
    await expect(p).resolves.toBe(false);
    const st = useWorldStore.getState();
    expect(st.self?.seatId).toBeNull();
    expect(st.actionError).toEqual({ code: 'TOO_FAR', message: 'Quá xa ghế' });
  });

  it('standUp gửi player:stand và bỏ ghế khi ack ok; đang đứng thì không gửi', async () => {
    await joinedWorld();
    expect(await useWorldStore.getState().standUp()).toBe(false);
    expect(fake.emitted.some((e) => e.event === 'player:stand')).toBe(false);

    const sit = useWorldStore.getState().sitSeat(SEAT);
    fake.lastEmit('player:sit').ack?.({ ok: true, data: { seatId: SEAT } });
    await sit;

    const stand = useWorldStore.getState().standUp();
    fake.lastEmit('player:stand').ack?.({ ok: true, data: {} });
    await expect(stand).resolves.toBe(true);
    const st = useWorldStore.getState();
    expect(st.self?.seatId).toBeNull();
    expect(st.takenSeats[SEAT]).toBeUndefined();
  });

  it('không gửi player:sit khi chưa joined, hoặc khi đã ngồi', async () => {
    expect(await useWorldStore.getState().sitSeat(SEAT)).toBe(false);
    expect(fake.emitted.some((e) => e.event === 'player:sit')).toBe(false);

    await joinedWorld();
    const sit = useWorldStore.getState().sitSeat(SEAT);
    fake.lastEmit('player:sit').ack?.({ ok: true, data: { seatId: SEAT } });
    await sit;
    const before = fake.emitted.length;
    expect(await useWorldStore.getState().sitSeat('D1-S1')).toBe(false);
    expect(fake.emitted.length).toBe(before);
  });
});

describe('worldStore: chat', () => {
  const MSG = '00000000-0000-4000-8000-0000000000c1';
  const CLIENT_MSG = '00000000-0000-4000-8000-0000000000d1';

  it('chat:message đặt lastChat và thêm vào recentChat', async () => {
    await joinedWorld();
    fake.fire('chat:message', { id: MSG, userId: OTHER, displayName: 'Minh', text: 'Chào', at: '2026-11-06T00:00:00.000Z' });
    const st = useWorldStore.getState();
    expect(st.lastChat?.id).toBe(MSG);
    expect(st.recentChat).toHaveLength(1);
  });

  it('nạp lại world không đặt lastChat', async () => {
    await joinedWorld();
    fake.fire('world:state', worldState({ recentChat: [{ id: MSG, userId: OTHER, displayName: 'Minh', text: 'cũ', at: '2026-11-06T00:00:00.000Z' }] }));
    expect(useWorldStore.getState().recentChat).toHaveLength(1);
    expect(useWorldStore.getState().lastChat).toBeNull();
  });

  it('sendChat gửi chat:send đúng payload, thành công thì trả true', async () => {
    await joinedWorld();
    const p = useWorldStore.getState().sendChat('Chào', CLIENT_MSG);
    expect(fake.lastEmit('chat:send').req).toEqual({ text: 'Chào', clientMsgId: CLIENT_MSG });
    fake.lastEmit('chat:send').ack?.({ ok: true, data: { id: MSG } });
    await expect(p).resolves.toBe(true);
    expect(useWorldStore.getState().chatError).toBeNull();
  });

  it('sendChat lỗi RATE_LIMITED thì đặt chatError và trả false, không thử lại', async () => {
    await joinedWorld();
    const p = useWorldStore.getState().sendChat('Chào', CLIENT_MSG);
    fake.lastEmit('chat:send').ack?.({
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'chậm lại', retryable: true },
    });
    await expect(p).resolves.toBe(false);
    expect(useWorldStore.getState().chatError?.code).toBe('RATE_LIMITED');
    expect(fake.emitted.filter((e) => e.event === 'chat:send')).toHaveLength(1);
  });

  it('sendChat khi chưa joined thì không emit', async () => {
    expect(await useWorldStore.getState().sendChat('Chào', CLIENT_MSG)).toBe(false);
    expect(fake.emitted.some((e) => e.event === 'chat:send')).toBe(false);
  });
});

describe('cold start qua socket (§3.10.6)', () => {
  it('không nối được trong 5 giây thì connectivity waking; nối được thì ok', async () => {
    useFake();
    useWorldStore.getState().connect(SERVER);
    fake.fire('connect_error', new Error('websocket error'));
    await tick(4_999);
    expect(useConnectivityStore.getState().status).toBe('ok');
    await tick(1);
    expect(useConnectivityStore.getState().status).toBe('waking');
    fake.fire('connect');
    expect(useConnectivityStore.getState().status).toBe('ok');
    useWorldStore.getState().disconnectWorld();
  });

  it('joined thì gửi world:ping mỗi 5 phút; rời quán thì dừng', async () => {
    useFake();
    await joinedWorld();
    const pings = () => fake.emitted.filter((e) => e.event === 'world:ping').length;
    await tick(300_000);
    expect(pings()).toBe(1);
    await tick(300_000);
    expect(pings()).toBe(2);
    useWorldStore.getState().disconnectWorld();
    await tick(600_000);
    expect(pings()).toBe(2);
  });
});
