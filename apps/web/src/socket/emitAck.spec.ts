import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ack } from '@tdvh/shared';
import type { TypedSocket } from './createSocket';
import { emitAck } from './emitAck';

type Ackfn = (res: Ack<unknown>) => void;

// Socket giả chỉ cần emit: ghi lại callback để test trả ack hoặc bỏ mặc (timeout).
function fakeSocket() {
  const calls: Array<{ event: string; req: unknown; ack: Ackfn }> = [];
  const socket = {
    emit: (event: string, req: unknown, ack: Ackfn) => {
      calls.push({ event, req, ack });
      return socket;
    },
  };
  return { socket: socket as unknown as TypedSocket, calls };
}

const ROOM = '00000000-0000-4000-8000-0000000000a1';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('emitAck', () => {
  it('trả về ack của server khi có phản hồi trước timeout', async () => {
    const { socket, calls } = fakeSocket();
    const p = emitAck(socket, 'world:join', { serverId: ROOM }, { timeoutMs: 5000, retries: 0 });
    expect(calls[0]?.event).toBe('world:join');
    expect(calls[0]?.req).toEqual({ serverId: ROOM });
    calls[0]?.ack({ ok: true, data: { done: true } } as Ack<unknown>);
    await expect(p).resolves.toEqual({ ok: true, data: { done: true } });
    // Timer đã được xóa, không còn gì chờ.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lỗi từ server được trả nguyên, không thử lại', async () => {
    const { socket, calls } = fakeSocket();
    const p = emitAck(socket, 'world:join', { serverId: ROOM }, { timeoutMs: 5000, retries: 2 });
    calls[0]?.ack({ ok: false, error: { code: 'SERVER_FULL', message: 'Đầy', retryable: false } });
    await expect(p).resolves.toMatchObject({ ok: false, error: { code: 'SERVER_FULL' } });
    expect(calls).toHaveLength(1);
  });

  it('hết giờ và retries 0 thì trả lỗi retryable, không ném exception', async () => {
    const { socket, calls } = fakeSocket();
    const p = emitAck(socket, 'world:join', { serverId: ROOM }, { timeoutMs: 5000, retries: 0 });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toMatchObject({ ok: false, error: { retryable: true } });
    expect(calls).toHaveLength(1);
  });

  it('hết giờ với retries 2 thì gửi tối đa 3 lần rồi dừng', async () => {
    const { socket, calls } = fakeSocket();
    const p = emitAck(socket, 'world:join', { serverId: ROOM }, { timeoutMs: 1000, retries: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toMatchObject({ ok: false, error: { retryable: true } });
    expect(calls).toHaveLength(3);
  });

  it('ack đến muộn sau timeout bị bỏ qua', async () => {
    const { socket, calls } = fakeSocket();
    const p = emitAck(socket, 'world:join', { serverId: ROOM }, { timeoutMs: 1000, retries: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    calls[0]?.ack({ ok: true, data: {} });
    await expect(p).resolves.toMatchObject({ ok: false });
  });
});
