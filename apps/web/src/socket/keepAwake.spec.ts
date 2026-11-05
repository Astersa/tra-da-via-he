// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startKeepAwake, type KeepAwakeSocket } from './keepAwake';

const INTERVAL = 300_000;

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

function fakeSocket(connected = true) {
  const emit = vi.fn();
  const socket: KeepAwakeSocket = {
    get connected() {
      return connected;
    },
    emit: emit as unknown as KeepAwakeSocket['emit'],
  };
  return { socket, emit, setConnected: (v: boolean) => (connected = v) };
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startKeepAwake', () => {
  it('tab hiển thị và socket nối: gửi world:ping đúng chu kỳ 5 phút', () => {
    const { socket, emit } = fakeSocket(true);
    const stop = startKeepAwake(socket, { intervalMs: INTERVAL, isVisible: () => document.visibilityState === 'visible' });

    vi.advanceTimersByTime(INTERVAL - 1);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toBe('world:ping');
    vi.advanceTimersByTime(INTERVAL);
    expect(emit).toHaveBeenCalledTimes(2);
    stop();
  });

  it('tab ẩn thì không gửi và dừng chu kỳ; hiện lại thì đặt lại chu kỳ', () => {
    const { socket, emit } = fakeSocket(true);
    const stop = startKeepAwake(socket, { intervalMs: INTERVAL, isVisible: () => document.visibilityState === 'visible' });

    vi.advanceTimersByTime(120_000);
    setVisibility('hidden');
    vi.advanceTimersByTime(INTERVAL * 3);
    expect(emit).not.toHaveBeenCalled();

    setVisibility('visible');
    vi.advanceTimersByTime(INTERVAL - 1);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledTimes(1);
    stop();
  });

  it('socket ngắt thì không gửi', () => {
    const { socket, emit, setConnected } = fakeSocket(true);
    const stop = startKeepAwake(socket, { intervalMs: INTERVAL, isVisible: () => true });
    setConnected(false);
    vi.advanceTimersByTime(INTERVAL);
    expect(emit).not.toHaveBeenCalled();
    setConnected(true);
    vi.advanceTimersByTime(INTERVAL);
    expect(emit).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stop dọn timer và listener: không gửi nữa, tab hiện lại cũng không khởi động lại', () => {
    const { socket, emit } = fakeSocket(true);
    const stop = startKeepAwake(socket, { intervalMs: INTERVAL, isVisible: () => document.visibilityState === 'visible' });
    stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(INTERVAL * 2);
    setVisibility('hidden');
    setVisibility('visible');
    vi.advanceTimersByTime(INTERVAL * 2);
    expect(emit).not.toHaveBeenCalled();
  });
});
