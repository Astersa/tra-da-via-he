import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeResSchema } from '@tdvh/shared';
import { ApiError, onSessionLost, request, setAccessToken, getAccessToken } from './client';

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

    await expect(request('/me', { schema: MeResSchema })).rejects.toBeInstanceOf(TypeError);
    off();
    expect(lost).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('old');
  });

  it('lỗi có mã lạ được đổi thành INTERNAL_ERROR; body không phải JSON cũng vậy', async () => {
    mockFetch(() => json(400, { error: { code: 'NOT_A_CODE', message: 'x' } }));
    const a = (await request('/x').catch((e: unknown) => e)) as ApiError;
    expect(a.code).toBe('INTERNAL_ERROR');

    mockFetch(() => new Response('<html>502</html>', { status: 502 }));
    const b = (await request('/x').catch((e: unknown) => e)) as ApiError;
    expect(b.code).toBe('INTERNAL_ERROR');
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
