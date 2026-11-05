import { ERROR_CODES, RefreshResSchema, type ErrorCode } from '@tdvh/shared';
import { useConnectivityStore } from '../store/connectivityStore';

export const API_BASE = '/api/v1';
const REFRESH_LOCK = 'tdvh-refresh';

// SERVICE_WAKING là mã nội bộ của client (không nằm trong ERROR_CODES): lỗi tạm thời do service đang ngủ.
export type ClientErrorCode = ErrorCode | 'SERVICE_WAKING';

// 502/503/504 từ proxy của Render khi service đang ngủ hoặc khởi động lại (§3.10.6).
const WAKING_STATUSES = new Set([502, 503, 504]);

// Chỉ cần safeParse: tránh kéo zod vào apps/web.
export interface Parser<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;

  constructor(code: ClientErrorCode, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export interface RequestOpts<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  schema?: Parser<T>;
}

// Access token chỉ nằm trong bộ nhớ module (không localStorage, không sessionStorage).
let accessToken: string | null = null;
const tokenListeners = new Set<(token: string | null) => void>();
const lostListeners = new Set<() => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const listener of tokenListeners) listener(token);
}

export function onTokenChange(listener: (token: string | null) => void): () => void {
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
  };
}

// Gọi khi refresh bị 401: phiên không còn, phía client phải đăng xuất.
export function onSessionLost(listener: () => void): () => void {
  lostListeners.add(listener);
  return () => {
    lostListeners.delete(listener);
  };
}

function notifySessionLost(): void {
  setAccessToken(null);
  for (const listener of lostListeners) listener();
}

// Khóa liên tab qua navigator.locks; không có thì xếp hàng trong tab.
let localQueue: Promise<unknown> = Promise.resolve();

function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks) return locks.request(REFRESH_LOCK, task);
  const run = localQueue.then(task, task);
  localQueue = run.catch(() => undefined);
  return run;
}

let inflightRefresh: Promise<boolean> | null = null;

// Trả true nếu có access token mới. Nhiều request cùng nhận 401 chỉ gây một lần refresh.
// Lỗi mạng hoặc 5xx được ném ra và KHÔNG đăng xuất (§3.10.6: chỉ 401 nghĩa là chưa đăng nhập).
export function refreshSession(staleToken: string | null = accessToken): Promise<boolean> {
  if (accessToken !== null && accessToken !== staleToken) return Promise.resolve(true);
  if (!inflightRefresh) {
    inflightRefresh = withRefreshLock(doRefresh).finally(() => {
      inflightRefresh = null;
    });
  }
  return inflightRefresh;
}

// Lỗi tạm thời: đánh dấu service đang thức và ném SERVICE_WAKING. Không đăng xuất, không xóa token.
function wakingError(status: number): ApiError {
  useConnectivityStore.getState().markWaking();
  return new ApiError('SERVICE_WAKING', 'Quán đang mở cửa, chờ chút rồi thử lại', status);
}

// Lỗi mạng (fetch ném) được coi là service chưa thức.
async function fetchOrWake(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw wakingError(0);
  }
}

async function doRefresh(): Promise<boolean> {
  const res = await fetchOrWake(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (res.status === 401) {
    notifySessionLost();
    return false;
  }
  if (WAKING_STATUSES.has(res.status)) throw wakingError(res.status);
  if (!res.ok) {
    throw new ApiError('INTERNAL_ERROR', 'Refresh thất bại', res.status);
  }
  const json: unknown = await res.json().catch(() => undefined);
  // 2xx nhưng không phải JSON: thường là trang chờ của proxy, coi là service chưa thức.
  if (json === undefined) throw wakingError(res.status);
  const parsed = RefreshResSchema.safeParse(json);
  if (!parsed.success) throw new ApiError('INTERNAL_ERROR', 'Phản hồi không hợp lệ', res.status);
  setAccessToken(parsed.data.accessToken);
  useConnectivityStore.getState().markOk();
  return true;
}

// Các đường này không tự refresh khi nhận 401.
const NO_REFRESH_PATHS = new Set(['/auth/refresh', '/auth/login', '/auth/guest', '/auth/logout']);

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

async function send(path: string, opts: RequestOpts<unknown>, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetchOrWake(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'include',
  });
}

async function parseResponse<T>(res: Response, opts: RequestOpts<T>): Promise<T> {
  if (WAKING_STATUSES.has(res.status)) throw wakingError(res.status);
  const json: unknown = await res.json().catch(() => undefined);
  // 204 không có body là bình thường (logout). Các trường hợp khác không phải JSON: coi là service chưa thức.
  if (json === undefined && res.status !== 204) throw wakingError(res.status);
  if (!res.ok) {
    const error = (json as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
    const code = isErrorCode(error?.code) ? error.code : 'INTERNAL_ERROR';
    const message = typeof error?.message === 'string' ? error.message : 'Lỗi không xác định';
    throw new ApiError(code, message, res.status);
  }
  useConnectivityStore.getState().markOk();
  if (!opts.schema) return undefined as T;
  const parsed = opts.schema.safeParse(json);
  if (!parsed.success) throw new ApiError('INTERNAL_ERROR', 'Phản hồi không hợp lệ', res.status);
  return parsed.data;
}

// Gọi REST. Nhận 401 thì refresh đúng một lần rồi gửi lại; vẫn 401 thì ném lỗi, không refresh tiếp.
export async function request<T>(path: string, opts: RequestOpts<T> = {}): Promise<T> {
  const staleToken = accessToken;
  let res = await send(path, opts as RequestOpts<unknown>, staleToken);
  if (res.status === 401 && !NO_REFRESH_PATHS.has(path)) {
    const refreshed = await refreshSession(staleToken);
    if (!refreshed) throw new ApiError('UNAUTHENTICATED', 'Bạn cần vào quán lại', 401);
    res = await send(path, opts as RequestOpts<unknown>, accessToken);
  }
  return parseResponse(res, opts);
}
