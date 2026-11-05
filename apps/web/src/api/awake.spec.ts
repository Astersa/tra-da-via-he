import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitUntilAwake } from './awake';
import { useConnectivityStore } from '../store/connectivityStore';

function mockHealth(handler: () => Response | Promise<Response>) {
  const fn = vi.fn(async (_input: string, _init?: RequestInit) => handler());
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.useFakeTimers();
  useConnectivityStore.setState({ status: 'ok', since: null, gaveUp: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('waitUntilAwake', () => {
  it('gọi health mỗi 5 giây tới khi đạt rồi về ok', async () => {
    let calls = 0;
    const fetchMock = mockHealth(() => {
      calls += 1;
      return new Response('{"status":"ok"}', { status: calls < 3 ? 503 : 200 });
    });

    const done = waitUntilAwake();
    expect(useConnectivityStore.getState().status).toBe('waking');
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(done).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/health');
    expect(useConnectivityStore.getState().status).toBe('ok');
  });

  it('lỗi mạng khi health vẫn tiếp tục chờ', async () => {
    let calls = 0;
    mockHealth(() => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return new Response('{}', { status: 200 });
    });
    const done = waitUntilAwake();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(done).resolves.toBe(true);
  });

  it('chỉ một vòng chờ tại một thời điểm: gọi lần hai nhận cùng kết quả, không thêm request', async () => {
    const fetchMock = mockHealth(() => new Response('{}', { status: 200 }));
    const a = waitUntilAwake();
    const b = waitUntilAwake();
    expect(a).toBe(b);
    await vi.advanceTimersByTimeAsync(0);
    await expect(a).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('quá 180 giây thì dừng, đặt gaveUp; gọi lại thì chờ tiếp', async () => {
    const fetchMock = mockHealth(() => new Response('', { status: 503 }));
    const done = waitUntilAwake();
    await vi.advanceTimersByTimeAsync(180_000);
    await expect(done).resolves.toBe(false);
    expect(useConnectivityStore.getState().gaveUp).toBe(true);
    expect(useConnectivityStore.getState().status).toBe('waking');

    const callsAtGiveUp = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock.mock.calls.length).toBe(callsAtGiveUp);

    fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }));
    const again = waitUntilAwake();
    expect(useConnectivityStore.getState().gaveUp).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(again).resolves.toBe(true);
    expect(useConnectivityStore.getState().status).toBe('ok');
  });
});
