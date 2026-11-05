import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeResSchema } from '@tdvh/shared';
import { ApiError, onSessionLost, request, setAccessToken, getAccessToken } from './client';
import { useConnectivityStore } from '../store/connectivityStore';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ME_BODY = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'GUEST',
    username: null,
    role: 'PLAYER',
    mutedUntil: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  profile: { userId: '00000000-0000-4000-8000-000000000001', displayName: 'Lan', avatarId: 'avatar_01' },
};

function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init ?? {}),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

function callsTo(fn: ReturnType<typeof mockFetch>, suffix: string): number {
  return fn.mock.calls.filter(([url]) => String(url).endsWith(suffix)).length;
}

beforeEach(() => {
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('request', () => {
  it('401 thì refresh đúng 1 lần rồi gọi lại với token mới', async () => {
    setAccessToken('old');
    const fetchMock = mockFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) return json(200, { accessToken: 'new' });
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new' ? json(200, ME_BODY) : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    });

    const me = await request('/me', { schema: MeResSchema });

    expect(me.profile.displayName).toBe('Lan');
    expect(callsTo(fetchMock, '/auth/refresh')).toBe(1);
    expect(getAccessToken()).toBe('new');
  });

  it('gửi credentials include và Bearer token trong bộ nhớ', async () => {
    setAccessToken('tok');
    const fetchMock = mockFetch(() => json(200, ME_BODY));
    await request('/me', { schema: MeResSchema });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/me');
    expect(init?.credentials).toBe('include');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('hai request đồng thời cùng nhận 401 chỉ gây một lần refresh', async () => {
    setAccessToken('old');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = mockFetch(async (url, init) => {
      if (url.endsWith('/auth/refresh')) {
        await gate;
        return json(200, { accessToken: 'new' });
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new' ? json(200, ME_BODY) : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    });

    const a = request('/me', { schema: MeResSchema });
    const b = request('/me', { schema: MeResSchema });
    await vi.waitFor(() => expect(callsTo(fetchMock, '/auth/refresh')).toBe(1));
    release();
    await Promise.all([a, b]);

    expect(callsTo(fetchMock, '/auth/refresh')).toBe(1);
  });

  it('refresh thất bại thì đăng xuất phía client, không refresh lặp', async () => {
    setAccessToken('old');
    const lost = vi.fn();
    const off = onSessionLost(lost);
    const fetchMock = mockFetch((url) =>
      url.endsWith('/auth/refresh')
        ? json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } })
        : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }),
    );

    const err = await request('/me', { schema: MeResSchema }).catch((e: unknown) => e);

    off();
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('UNAUTHENTICATED');
    expect(lost).toHaveBeenCalledTimes(1);
    expect(callsTo(fetchMock, '/auth/refresh')).toBe(1);
    expect(callsTo(fetchMock, '/me')).toBe(1);
    expect(getAccessToken()).toBeNull();
  });

  it('vẫn 401 sau khi refresh thì ném lỗi, không refresh thêm', async () => {
    setAccessToken('old');
    const fetchMock = mockFetch((url) =>
      url.endsWith('/auth/refresh')
        ? json(200, { accessToken: 'new' })
        : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }),
    );

    await expect(request('/me', { schema: MeResSchema })).rejects.toBeInstanceOf(ApiError);
    expect(callsTo(fetchMock, '/auth/refresh')).toBe(1);
    expect(callsTo(fetchMock, '/me')).toBe(2);
  });

  it('/auth/refresh nhận 401 không tự kích hoạt refresh', async () => {
    const fetchMock = mockFetch(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));
    const lost = vi.fn();
    const off = onSessionLost(lost);

    await expect(request('/auth/refresh', { method: 'POST' })).rejects.toBeInstanceOf(ApiError);
    off();
    expect(callsTo(fetchMock, '/auth/refresh')).toBe(1);
    expect(lost).not.toHaveBeenCalled();
  });

  it('lỗi mạng khi refresh không đăng xuất', async () => {
    setAccessToken('old');
    const lost = vi.fn();
    const off = onSessionLost(lost);
    mockFetch((url) => {
      if (url.endsWith('/auth/refresh')) throw new TypeError('fetch failed');
      return json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    });

    const err = (await request('/me', { schema: MeResSchema }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('SERVICE_WAKING');
    off();
    expect(lost).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('old');
  });

  it('lỗi có mã lạ được đổi thành INTERNAL_ERROR; 502 là SERVICE_WAKING chứ không phải lỗi thường', async () => {
    mockFetch(() => json(400, { error: { code: 'NOT_A_CODE', message: 'x' } }));
    const a = (await request('/x').catch((e: unknown) => e)) as ApiError;
    expect(a.code).toBe('INTERNAL_ERROR');

    mockFetch(() => new Response('<html>502</html>', { status: 502 }));
    const b = (await request('/x').catch((e: unknown) => e)) as ApiError;
    expect(b.code).toBe('SERVICE_WAKING');
    expect(b.status).toBe(502);
  });

  it('dùng navigator.locks với tên tdvh-refresh khi trình duyệt có', async () => {
    setAccessToken('old');
    const request_ = vi.fn(async (_name: string, task: () => Promise<unknown>) => task());
    vi.stubGlobal('navigator', { locks: { request: request_ } });
    mockFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) return json(200, { accessToken: 'new' });
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new' ? json(200, ME_BODY) : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    });

    await request('/me', { schema: MeResSchema });
    expect(request_.mock.calls[0]?.[0]).toBe('tdvh-refresh');
  });
});

// Cold start (§3.10.6): lỗi tạm thời đánh dấu waking, không đăng xuất; chỉ 401 mới là chưa đăng nhập.
describe('cold start', () => {
  beforeEach(() => {
    useConnectivityStore.setState({ status: 'ok', since: null, gaveUp: false });
  });

  it.each([502, 503, 504])('HTTP %i trên /api đánh dấu waking và ném SERVICE_WAKING', async (status) => {
    mockFetch(() => new Response('<html>wait</html>', { status }));
    const err = (await request('/me').catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('SERVICE_WAKING');
    expect(useConnectivityStore.getState().status).toBe('waking');
  });

  it('body không phải JSON với 200 đánh dấu waking', async () => {
    mockFetch(() => new Response('<html>Render</html>', { status: 200 }));
    const err = (await request('/me').catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('SERVICE_WAKING');
    expect(useConnectivityStore.getState().status).toBe('waking');
  });

  it('401 không đánh dấu waking', async () => {
    setAccessToken('old');
    mockFetch(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));
    await request('/me').catch(() => undefined);
    expect(useConnectivityStore.getState().status).toBe('ok');
  });

  it('refresh bị 503 không đăng xuất và giữ token', async () => {
    setAccessToken('old');
    const lost = vi.fn();
    const off = onSessionLost(lost);
    mockFetch((url) =>
      url.endsWith('/auth/refresh')
        ? new Response('', { status: 503 })
        : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }),
    );
    const err = (await request('/me', { schema: MeResSchema }).catch((e: unknown) => e)) as ApiError;
    off();
    expect(err.code).toBe('SERVICE_WAKING');
    expect(lost).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('old');
    expect(useConnectivityStore.getState().status).toBe('waking');
  });

  it('refresh bị 401 vẫn đăng xuất như cũ', async () => {
    setAccessToken('old');
    const lost = vi.fn();
    const off = onSessionLost(lost);
    mockFetch(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));
    await request('/me', { schema: MeResSchema }).catch(() => undefined);
    off();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(useConnectivityStore.getState().status).toBe('ok');
  });

  it('POST /auth/guest bị 503 không tự gửi lại', async () => {
    const fetchMock = mockFetch(() => new Response('', { status: 503 }));
    const err = (await request('/auth/guest', { method: 'POST', body: {} }).catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('SERVICE_WAKING');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('request thành công xóa trạng thái waking', async () => {
    useConnectivityStore.getState().markWaking();
    mockFetch(() => json(200, ME_BODY));
    await request('/me', { schema: MeResSchema });
    expect(useConnectivityStore.getState().status).toBe('ok');
  });

  it('logout 204 không có body không bị coi là waking', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await request('/auth/logout', { method: 'POST' });
    expect(useConnectivityStore.getState().status).toBe('ok');
  });
});
