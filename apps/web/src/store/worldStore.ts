import {
  ServerEventSchemas,
  WorldStateSchema,
  type ChatMessage,
  type OrderView,
  type PlayerMoveReq,
  type PlayerView,
  type ServerToClientEvents,
  type ShopSummary,
  type WalletView,
  type WorldState,
} from '@tdvh/shared';
import { create } from 'zustand';
import { ApiError, getAccessToken, onSessionLost, onTokenChange, refreshSession, type ClientErrorCode } from '../api/client';
import { useServerStore } from './serverStore';
import { createSocket, type TypedSocket } from '../socket/createSocket';
import { emitAck } from '../socket/emitAck';
import { startKeepAwake } from '../socket/keepAwake';
import { useConnectivityStore } from './connectivityStore';

type Plot = WorldState['plots'][number];
type Staff = WorldState['staff'];
type Payload<K extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[K]>[0];

export type WorldStatus = 'idle' | 'connecting' | 'joined' | 'reconnecting' | 'disconnected' | 'replaced' | 'error';

// Dữ liệu world theo §3.4.1 (WorldState), đổi theo từng event.
export interface WorldData {
  sessionId: string | null;
  serverId: string | null;
  self: PlayerView | null;
  players: Record<string, PlayerView>;
  takenSeats: Record<string, string>; // seatId -> userId
  shops: Record<string, ShopSummary>;
  plots: Plot[];
  recentChat: ChatMessage[];
  wallet: WalletView | null;
  myOpenOrders: Record<string, OrderView>;
  staff: Staff;
  mapVersion: number;
}

export interface WorldStore extends WorldData {
  status: WorldStatus;
  // true sau session:replaced: tab này đã bị tab khác chiếm, không tự nối lại.
  sessionLost: boolean;
  replacedReason: 'NEW_TAB' | 'SWITCHED' | null;
  error: { code: string; message: string } | null;
  // Tăng mỗi lần vị trí của mình được đặt lại từ server (world:state hoặc player:moved corrected).
  // Game dùng để biết khi nào phải về vị trí server; đi bình thường không đổi giá trị này.
  positionSync: number;
  // Nối socket và gọi world:join cho server này.
  connect: (serverId: string) => void;
  // Ngắt socket, dừng mọi timer, xóa world store và sessionStorage.
  disconnectWorld: () => void;
  // Gửi player:move (không ack). false nếu chưa joined, đang ngồi, hoặc socket chưa nối.
  sendMove: (req: PlayerMoveReq) => boolean;
  // Lỗi của hành động ngồi/đứng gần nhất (từ server, hoặc hết giờ). null khi không có lỗi.
  actionError: { code: string; message: string } | null;
  // Ngồi vào ghế qua player:sit. true khi server nhận; lỗi thì đặt actionError và trả false.
  sitSeat: (seatId: string) => Promise<boolean>;
  // Đứng dậy qua player:stand. Cùng quy ước với sitSeat.
  standUp: () => Promise<boolean>;
  clearActionError: () => void;
  // Tin chat mới nhất nhận qua chat:message (dùng để vẽ bong bóng). Không đổi khi chỉ nạp lại recentChat.
  lastChat: ChatMessage | null;
  // Lỗi của lần gửi chat gần nhất. null khi không có lỗi.
  chatError: { code: string; message: string } | null;
  // Gửi chat:send. true khi server nhận; lỗi thì đặt chatError và trả false (ô nhập giữ nguyên nội dung).
  sendChat: (text: string, clientMsgId: string) => Promise<boolean>;
  clearChatError: () => void;
  // Đổi máy chủ qua server:switch (§3.5.3). true khi server chấp nhận và state đã thay sang server đích.
  // Thất bại thì giữ nguyên server hiện tại, đặt switchError và trả false. Đang chuyển thì trả false ngay (chặn gửi trùng).
  switching: boolean;
  switchError: ApiError | null;
  switchServer: (targetServerId: string) => Promise<boolean>;
  clearSwitchError: () => void;
}

const EMPTY_DATA: WorldData = {
  sessionId: null,
  serverId: null,
  self: null,
  players: {},
  takenSeats: {},
  shops: {},
  plots: [],
  recentChat: [],
  wallet: null,
  myOpenOrders: {},
  staff: null,
  mapVersion: 0,
};

const INITIAL = {
  ...EMPTY_DATA,
  status: 'idle' as WorldStatus,
  sessionLost: false,
  replacedReason: null as WorldStore['replacedReason'],
  error: null as WorldStore['error'],
  positionSync: 0,
  actionError: null as WorldStore['actionError'],
  lastChat: null as ChatMessage | null,
  chatError: null as WorldStore['chatError'],
  switching: false,
  switchError: null as ApiError | null,
};

const MAX_CHAT = 50;
const JOIN_TIMEOUT_MS = 5000;
const ACTION_TIMEOUT_MS = 5000;
const BACKOFF_CAP_MS = 30_000;
const AUTH_ERROR_CODES = new Set(['TOKEN_EXPIRED', 'UNAUTHENTICATED']);
// Lý do mất kết nối do mạng: refresh token rồi nối lại. Các lý do khác không tự nối lại.
const RECONNECT_REASONS = new Set(['transport close', 'ping timeout', 'transport error']);
const STORAGE_KEY = 'tdvh.world';
// Socket không nối lại được sau 5 giây thì coi là service đang ngủ (§3.10.6).
const WAKING_AFTER_MS = 5000;
// Mỗi 5 phút khi tab hiển thị và đã joined (§3.10.6); không dùng pinger ngoài.
const KEEP_AWAKE_MS = 300_000;

// ---- Trạng thái kết nối (biến module, không đưa vào state để khỏi render) ----
let activeSocket: TypedSocket | null = null;
let stopped = true;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;
let authRetried = false;
let wakingTimer: ReturnType<typeof setTimeout> | null = null;
let stopKeepAwake: (() => void) | null = null;
// seq mới nhất đã áp dụng cho từng người chơi khác (chống áp dụng bản cũ).
const lastSeq = new Map<string, number>();

export const useWorldStore = create<WorldStore>()((set) => ({
  ...INITIAL,

  connect: (serverId) => {
    const s = attachSocket();
    lastSeq.clear();
    set({ ...INITIAL, status: 'connecting', serverId });
    armWakingTimer(s);
    s.connect();
  },

  disconnectWorld: () => disconnectWorld(),

  sendMove: (req) => {
    const st = useWorldStore.getState();
    const s = activeSocket;
    if (!s || !s.connected || st.status !== 'joined' || !st.self || st.self.seatId) return false;
    s.emit('player:move', req);
    return true;
  },

  sitSeat: (seatId) => seatAction(seatId),
  standUp: () => seatAction(null),
  clearActionError: () => setWorld({ actionError: null }),
  sendChat: (text, clientMsgId) => chatAction(text, clientMsgId),
  clearChatError: () => setWorld({ chatError: null }),
  switchServer: (targetServerId) => switchAction(targetServerId),
  clearSwitchError: () => setWorld({ switchError: null }),
}));

// server:switch trên cùng socket. Thành công thì thay toàn bộ state bằng WorldState của server đích và ghi lại bản lưu.
async function switchAction(targetServerId: string): Promise<boolean> {
  const st = useWorldStore.getState();
  const s = activeSocket;
  if (!s || !s.connected || st.status !== 'joined' || st.switching || targetServerId === st.serverId) return false;
  setWorld({ switching: true, switchError: null });
  const res = await emitAck(s, 'server:switch', { targetServerId }, { timeoutMs: ACTION_TIMEOUT_MS, retries: 0 });
  if (!isCurrent(s)) return false;
  if (!res.ok) {
    setWorld({ switching: false, switchError: new ApiError(res.error.code as ClientErrorCode, res.error.message, 409) });
    return false;
  }
  const parsed = WorldStateSchema.safeParse(res.data);
  if (!parsed.success) {
    setWorld({ switching: false });
    failWorld('INTERNAL_ERROR', 'Phản hồi không hợp lệ');
    return false;
  }
  applyWorldState(parsed.data);
  setWorld({ switching: false });
  saveResume(parsed.data.serverId, parsed.data.sessionId);
  return true;
}

// chat:send với clientMsgId do người gọi sinh. Không tự thử lại: gửi lại sẽ tạo yêu cầu mới.
async function chatAction(text: string, clientMsgId: string): Promise<boolean> {
  const st = useWorldStore.getState();
  const s = activeSocket;
  if (!s || !s.connected || st.status !== 'joined') return false;
  setWorld({ chatError: null });
  const res = await emitAck(s, 'chat:send', { text, clientMsgId }, { timeoutMs: ACTION_TIMEOUT_MS, retries: 0 });
  if (!isCurrent(s)) return false;
  if (!res.ok) {
    setWorld({ chatError: { code: res.error.code, message: res.error.message } });
    return false;
  }
  return true;
}

// player:sit (seatId) hoặc player:stand (null). Thành công thì cập nhật ghế của mình ngay, không chờ event.
async function seatAction(seatId: string | null): Promise<boolean> {
  const st = useWorldStore.getState();
  const s = activeSocket;
  if (!s || !s.connected || st.status !== 'joined' || !st.self) return false;
  if (seatId === null ? !st.self.seatId : st.self.seatId !== null) return false;
  setWorld({ actionError: null });
  const res =
    seatId === null
      ? await emitAck(s, 'player:stand', {}, { timeoutMs: ACTION_TIMEOUT_MS, retries: 0 })
      : await emitAck(s, 'player:sit', { seatId }, { timeoutMs: ACTION_TIMEOUT_MS, retries: 0 });
  if (!isCurrent(s)) return false;
  if (!res.ok) {
    setWorld({ actionError: { code: res.error.code, message: res.error.message } });
    return false;
  }
  const me = useWorldStore.getState().self;
  if (me) patchPlayer(me.userId, { seatId: seatId ?? null });
  return true;
}

// Đăng xuất (token về null) hoặc refresh thất bại: ngắt world.
onTokenChange((token) => {
  if (token === null) disconnectWorld();
});
onSessionLost(() => disconnectWorld());

// ---- Vòng đời socket ----

function isCurrent(s: TypedSocket): boolean {
  return !stopped && s === activeSocket;
}

function setWorld(patch: Partial<WorldStore>): void {
  useWorldStore.setState(patch);
}

function clearRetry(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function clearWakingTimer(): void {
  if (wakingTimer !== null) {
    clearTimeout(wakingTimer);
    wakingTimer = null;
  }
}

// Đặt hẹn 5 giây: nếu vẫn chưa nối được thì báo service đang thức (màn chờ). Đã đặt thì không đặt lại.
function armWakingTimer(s: TypedSocket): void {
  if (wakingTimer !== null) return;
  wakingTimer = setTimeout(() => {
    wakingTimer = null;
    if (isCurrent(s) && !s.connected) useConnectivityStore.getState().markWaking();
  }, WAKING_AFTER_MS);
}

function stopKeepAlive(): void {
  if (stopKeepAwake) stopKeepAwake();
  stopKeepAwake = null;
}

function detachSocket(): void {
  stopped = true;
  clearRetry();
  clearWakingTimer();
  stopKeepAlive();
  const s = activeSocket;
  activeSocket = null;
  if (s) {
    s.removeAllListeners();
    s.disconnect();
  }
}

function attachSocket(): TypedSocket {
  detachSocket();
  const s = createSocket(getAccessToken);
  activeSocket = s;
  stopped = false;
  retryCount = 0;
  authRetried = false;
  bindSocket(s);
  return s;
}

function disconnectWorld(): void {
  detachSocket();
  lastSeq.clear();
  clearResume();
  // Rời quán hoặc đăng xuất: không còn socket để chờ, bỏ trạng thái chờ do socket gây ra.
  useConnectivityStore.getState().markOk();
  setWorld({ ...INITIAL });
}

// Bật keepAwake sau khi joined; gọi lại thì thay bằng bộ đếm mới.
function startKeepAlive(s: TypedSocket): void {
  stopKeepAlive();
  stopKeepAwake = startKeepAwake(s as unknown as Parameters<typeof startKeepAwake>[0], {
    intervalMs: KEEP_AWAKE_MS,
    isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
  });
}

function scheduleRetry(s: TypedSocket): void {
  if (!isCurrent(s)) return;
  clearRetry();
  const delay = Math.min(1000 * 2 ** retryCount, BACKOFF_CAP_MS);
  retryCount += 1;
  setWorld({ status: 'reconnecting' });
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void resume(s);
  }, delay);
}

// Đang nối sẵn thì chỉ gọi lại world:join. Mất nối thì refresh token đúng một lần rồi connect.
async function resume(s: TypedSocket): Promise<void> {
  if (!isCurrent(s)) return;
  if (s.connected) {
    void joinWorld(s);
    return;
  }
  let ok: boolean;
  try {
    ok = await refreshSession(getAccessToken());
  } catch {
    // Lỗi mạng không đăng xuất; thử lại theo backoff.
    scheduleRetry(s);
    return;
  }
  if (!isCurrent(s)) return;
  if (!ok) {
    disconnectWorld();
    return;
  }
  s.connect();
}

async function onConnectError(s: TypedSocket, message: string): Promise<void> {
  if (!AUTH_ERROR_CODES.has(message)) {
    scheduleRetry(s);
    return;
  }
  // Token hết hạn: refresh đúng một lần. Vẫn bị từ chối thì dừng, không lặp.
  if (authRetried) {
    failWorld('UNAUTHENTICATED', 'Phiên không hợp lệ, hãy vào lại');
    return;
  }
  authRetried = true;
  let ok: boolean;
  try {
    ok = await refreshSession(getAccessToken());
  } catch {
    if (isCurrent(s)) scheduleRetry(s);
    return;
  }
  if (!isCurrent(s)) return;
  if (!ok) {
    disconnectWorld();
    return;
  }
  s.connect();
}

// world:join kèm resumeSessionId nếu có. Thành công thì thay toàn bộ state bằng WorldState.
async function joinWorld(s: TypedSocket): Promise<void> {
  const serverId = useWorldStore.getState().serverId;
  if (!serverId || !isCurrent(s)) return;
  const resumeSessionId = resumeIdFor(serverId);
  const req = resumeSessionId ? { serverId, resumeSessionId } : { serverId };
  const res = await emitAck(s, 'world:join', req, { timeoutMs: JOIN_TIMEOUT_MS, retries: 2 });
  if (!isCurrent(s)) return;
  if (!res.ok) {
    if (res.error.retryable) scheduleRetry(s);
    else if (JOIN_REJECT_CODES.has(res.error.code)) leaveToSelection(res.error.code, res.error.message);
    else failWorld(res.error.code, res.error.message);
    return;
  }
  const parsed = WorldStateSchema.safeParse(res.data);
  if (!parsed.success) {
    failWorld('INTERNAL_ERROR', 'Phản hồi không hợp lệ');
    return;
  }
  retryCount = 0;
  applyWorldState(parsed.data);
  setWorld({ status: 'joined', error: null });
  saveResume(serverId, parsed.data.sessionId);
  startKeepAlive(s);
}

function failWorld(code: string, message: string): void {
  setWorld({ status: 'error', error: { code, message } });
}

// Máy chủ không còn cho vào: bỏ bản lưu, về màn chọn máy chủ và báo lý do ở đó.
const JOIN_REJECT_CODES = new Set(['SERVER_NOT_FOUND', 'SERVER_NOT_ACTIVE', 'SERVER_FULL']);
function leaveToSelection(code: string, message: string): void {
  clearResume();
  disconnectWorld();
  useServerStore.setState({ joinError: new ApiError(code as ClientErrorCode, message, 409) });
}

// Sau khi đã đăng nhập (kể cả F5): nếu tab này đã vào quán và còn bản lưu thì nối lại đúng máy chủ đó,
// world:join kèm resumeSessionId. Trả false khi không có gì để khôi phục.
export function restoreWorld(): boolean {
  if (useWorldStore.getState().status !== 'idle') return false;
  const saved = loadResumeRecord();
  if (!saved) return false;
  useWorldStore.getState().connect(saved.serverId);
  return true;
}

function bindSocket(s: TypedSocket): void {
  s.on('connect', () => {
    if (!isCurrent(s)) return;
    clearWakingTimer();
    useConnectivityStore.getState().markOk();
    retryCount = 0;
    authRetried = false;
    void joinWorld(s);
  });
  s.on('connect_error', (err: Error) => {
    if (!isCurrent(s)) return;
    armWakingTimer(s);
    void onConnectError(s, err.message);
  });
  s.on('disconnect', (reason: string) => {
    if (!isCurrent(s)) return;
    if (RECONNECT_REASONS.has(reason)) {
      armWakingTimer(s);
      scheduleRetry(s);
    }
    else if (reason === 'io server disconnect') setWorld({ status: 'disconnected' });
    // 'io client disconnect' do chính ta gọi (detach): không làm gì.
  });

  listen(s, 'session:replaced', (evt) => {
    // §3.5.2: không tự nối lại. Người dùng bấm "Chơi ở tab này" để gọi connect lại.
    const serverId = useWorldStore.getState().serverId;
    detachSocket();
    lastSeq.clear();
    setWorld({
      ...EMPTY_DATA,
      serverId,
      status: 'replaced',
      sessionLost: true,
      replacedReason: evt.reason,
      error: null,
    });
  });
  listen(s, 'world:state', (ws) => applyWorldState(ws));
  // Số online theo máy chủ cho danh sách đổi máy chủ. Chỉ cập nhật online; các số liệu khác giữ từ REST.
  listen(s, 'server:population', (evt) => {
    const list = useServerStore.getState().servers;
    if (!list) return;
    const online = new Map(evt.servers.map((sv) => [sv.id, sv.online]));
    useServerStore.setState({
      servers: list.map((sv) => (online.has(sv.id) ? { ...sv, online: online.get(sv.id)! } : sv)),
    });
  });
  listen(s, 'player:joined', (p) => {
    const st = useWorldStore.getState();
    if (!st.self || p.userId === st.self.userId) return;
    setWorld({
      players: { ...st.players, [p.userId]: p },
      takenSeats: withSeat(st.takenSeats, p.userId, p.seatId),
    });
  });
  listen(s, 'player:left', (evt) => {
    const st = useWorldStore.getState();
    if (!st.self || evt.userId === st.self.userId) return;
    const players = { ...st.players };
    delete players[evt.userId];
    lastSeq.delete(evt.userId);
    setWorld({ players, takenSeats: withSeat(st.takenSeats, evt.userId, null) });
  });
  listen(s, 'player:moved', (evt) => {
    const st = useWorldStore.getState();
    if (!st.self) return;
    let self = st.self;
    const players = { ...st.players };
    let playersChanged = false;
    let positionChanged = false;
    for (const m of evt.moves) {
      if (m.userId === self.userId) {
        // Với mình chỉ áp dụng bản bị server sửa (corrected).
        if (m.corrected) {
          self = { ...self, x: m.x, y: m.y, dir: m.dir };
          positionChanged = true;
        }
        continue;
      }
      const prev = players[m.userId];
      const prevSeq = lastSeq.get(m.userId);
      if (!prev || (prevSeq !== undefined && m.seq <= prevSeq)) continue;
      lastSeq.set(m.userId, m.seq);
      players[m.userId] = { ...prev, x: m.x, y: m.y, dir: m.dir };
      playersChanged = true;
    }
    // Một lần set cho cả batch, không set theo từng move.
    if (self !== st.self || playersChanged) {
      setWorld({
        self,
        players: playersChanged ? players : st.players,
        positionSync: positionChanged ? st.positionSync + 1 : st.positionSync,
      });
    }
  });
  listen(s, 'player:interacted', (evt) => {
    const patch: Partial<PlayerView> = {};
    if (evt.state === 'DISCONNECTED') patch.connected = false;
    else if (evt.state === 'RECONNECTED') patch.connected = true;
    else if (evt.state === 'SIT' && evt.seatId) patch.seatId = evt.seatId;
    else if (evt.state === 'STAND') patch.seatId = null;
    // Emote (kind) không lưu vào store.
    if (Object.keys(patch).length > 0) patchPlayer(evt.userId, patch);
  });
  listen(s, 'chat:message', (msg) => {
    const st = useWorldStore.getState();
    if (!st.self) return;
    setWorld({
      recentChat: [...st.recentChat.filter((m) => m.id !== msg.id), msg].slice(-MAX_CHAT),
      lastChat: msg,
    });
  });
  listen(s, 'shop:updated', (shop) => {
    const st = useWorldStore.getState();
    if (!st.self) return;
    setWorld({ shops: { ...st.shops, [shop.id]: shop } });
  });
  listen(s, 'shop:order:created', applyOrderEvent);
  listen(s, 'shop:order:updated', applyOrderEvent);
  listen(s, 'wallet:updated', (evt) => {
    const st = useWorldStore.getState();
    // Bỏ event có version nhỏ hơn hoặc bằng bản đang giữ.
    if (!st.wallet || evt.version <= st.wallet.version) return;
    setWorld({
      wallet: { balance: evt.balance, held: evt.held, available: evt.available, version: evt.version },
    });
  });
}

// Đăng ký listener với payload được parse bằng schema shared. Payload sai bị bỏ, không ném lỗi.
interface Listenable {
  on(event: string, fn: (raw: unknown) => void): unknown;
}
type Parser<T> = { safeParse(data: unknown): { success: true; data: T } | { success: false } };

function listen<K extends keyof ServerToClientEvents>(
  s: TypedSocket,
  event: K,
  handler: (payload: Payload<K>) => void,
): void {
  const schema = ServerEventSchemas[event] as unknown as Parser<Payload<K>>;
  (s as unknown as Listenable).on(event, (raw: unknown) => {
    if (!isCurrent(s)) return;
    const parsed = schema.safeParse(raw);
    if (parsed.success) handler(parsed.data);
  });
}

// ---- Cập nhật state ----

function applyWorldState(ws: WorldState): void {
  lastSeq.clear();
  setWorld({
    positionSync: useWorldStore.getState().positionSync + 1,
    sessionId: ws.sessionId,
    serverId: ws.serverId,
    self: ws.self,
    players: indexBy(
      ws.players.filter((p) => p.userId !== ws.self.userId),
      (p) => p.userId,
    ),
    takenSeats: Object.fromEntries(ws.takenSeats.map((t) => [t.seatId, t.userId])),
    shops: indexBy(ws.shops, (shop) => shop.id),
    plots: ws.plots,
    recentChat: ws.recentChat.slice(-MAX_CHAT),
    wallet: ws.wallet,
    myOpenOrders: indexBy(ws.myOpenOrders, (o) => o.id),
    staff: ws.staff,
    mapVersion: ws.mapVersion,
  });
}

function patchPlayer(userId: string, patch: Partial<PlayerView>): void {
  const st = useWorldStore.getState();
  const isSelf = st.self?.userId === userId;
  const current = isSelf ? st.self : st.players[userId];
  if (!current) return;
  const next: PlayerView = { ...current, ...patch };
  if ('seatId' in patch) {
    setWorld({ takenSeats: withSeat(st.takenSeats, userId, next.seatId) });
  }
  if (isSelf) setWorld({ self: next });
  else setWorld({ players: { ...st.players, [userId]: next } });
}

function applyOrderEvent(evt: OrderView): void {
  const st = useWorldStore.getState();
  if (!st.self) return;
  const open = evt.status === 'PENDING' || evt.status === 'ACCEPTED';

  // Đơn của mình (là khách): bỏ bản cũ theo version, đơn đã kết thúc thì gỡ khỏi danh sách mở.
  if (evt.customerId === st.self.userId) {
    const prev = st.myOpenOrders[evt.id];
    if (!prev || evt.version > prev.version) {
      const myOpenOrders = { ...st.myOpenOrders };
      if (open) myOpenOrders[evt.id] = evt;
      else delete myOpenOrders[evt.id];
      setWorld({ myOpenOrders });
    }
  }

  // Hàng đợi của quán mình (là staff).
  if (st.staff && evt.shopId === st.staff.shopId) {
    const prev = st.staff.queue.find((o) => o.id === evt.id);
    if (!prev || evt.version > prev.version) {
      const others = st.staff.queue.filter((o) => o.id !== evt.id);
      const queue = open ? [...others, evt] : others;
      setWorld({ staff: { ...st.staff, queue } });
    }
  }
}

// Ghế: gỡ mọi ghế của userId, rồi gắn seatId mới nếu có.
function withSeat(seats: Record<string, string>, userId: string, seatId: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [seat, user] of Object.entries(seats)) {
    if (user !== userId) out[seat] = user;
  }
  if (seatId) out[seatId] = userId;
  return out;
}

function indexBy<T>(items: T[], key: (item: T) => string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[key(item)] = item;
  return out;
}

// ---- sessionId trong sessionStorage (try/catch: có thể không khả dụng) ----

function saveResume(serverId: string, sessionId: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ serverId, sessionId }));
  } catch {
    // Không lưu được thì vẫn chạy, chỉ mất khả năng giữ phiên khi F5.
  }
}

function loadResumeRecord(): { serverId: string; sessionId: string } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { serverId?: unknown; sessionId?: unknown };
    return typeof value.serverId === 'string' && typeof value.sessionId === 'string'
      ? { serverId: value.serverId, sessionId: value.sessionId }
      : null;
  } catch {
    return null;
  }
}

function loadResume(serverId: string): string | undefined {
  const saved = loadResumeRecord();
  return saved && saved.serverId === serverId ? saved.sessionId : undefined;
}

function clearResume(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Bỏ qua.
  }
}

function resumeIdFor(serverId: string): string | undefined {
  const st = useWorldStore.getState();
  if (st.sessionId && st.serverId === serverId) return st.sessionId;
  return loadResume(serverId);
}
