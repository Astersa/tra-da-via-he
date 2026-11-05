import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../api/client';
import { useAuthStore } from './authStore';
import { useConnectivityStore } from './connectivityStore';

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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Trả lời theo đường dẫn: refresh và health do từng test quyết định, /me luôn 200.
function routeFetch(handlers: { refresh: () => Response | Promise<Response>; health?: () => Response }) {
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/auth/refresh')) return handlers.refresh();
    if (url.endsWith('/health')) return handlers.health ? handlers.health() : json(200, { status: 'ok' });
    if (url.endsWith('/me')) return json(200, ME_BODY);
    return json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const countTo = (fn: ReturnType<typeof routeFetch>, suffix: string) =>
  fn.mock.calls.filter(([url]) => String(url).endsWith(suffix)).length;

beforeEach(() => {
  vi.useFakeTimers();
  setAccessToken(null);
  useAuthStore.setState({ status: 'booting', user: null, profile: null, upgradeRequest: null });
  useConnectivityStore.setState({ status: 'ok', since: null, gaveUp: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('bootstrap khi service đang ngủ (§3.10.6)', () => {
  it('refresh bị 503 không về anonymous; khi health đạt thì thử lại và vào đúng phiên', async () => {
    let refreshCalls = 0;
    let healthCalls = 0;
    const fn = routeFetch({
      refresh: () => {
        refreshCalls += 1;
        return refreshCalls === 1 ? new Response('', { status: 503 }) : json(200, { accessToken: 'tok' });
      },
      health: () => {
        healthCalls += 1;
        return new Response('', { status: healthCalls === 1 ? 503 : 200 });
      },
    });

    const done = useAuthStore.getState().bootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(useAuthStore.getState().status).toBe('booting');
    expect(useConnectivityStore.getState().status).toBe('waking');

    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    expect(useAuthStore.getState().status).toBe('signed-in');
    expect(useAuthStore.getState().user?.id).toBe(ME_BODY.user.id);
    expect(countTo(fn, '/auth/refresh')).toBe(2);
    expect(useConnectivityStore.getState().status).toBe('ok');
  });

  it('hai lần bootstrap đồng thời chỉ gọi refresh một lần', async () => {
    const fn = routeFetch({ refresh: () => json(200, { accessToken: 'tok' }) });
    const a = useAuthStore.getState().bootstrap();
    const b = useAuthStore.getState().bootstrap();
    await Promise.all([a, b]);
    expect(countTo(fn, '/auth/refresh')).toBe(1);
    expect(useAuthStore.getState().status).toBe('signed-in');
  });

  it('service không thức trong 180 giây thì boot-error (có nút Thử lại), không anonymous', async () => {
    routeFetch({
      refresh: () => new Response('', { status: 503 }),
      health: () => new Response('', { status: 503 }),
    });
    const done = useAuthStore.getState().bootstrap();
    await vi.advanceTimersByTimeAsync(180_000);
    await done;
    expect(useAuthStore.getState().status).toBe('boot-error');
    expect(useConnectivityStore.getState().gaveUp).toBe(true);
  });

  it('401 khi refresh vẫn là anonymous', async () => {
    routeFetch({ refresh: () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }) });
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useConnectivityStore.getState().status).toBe('ok');
  });
});
