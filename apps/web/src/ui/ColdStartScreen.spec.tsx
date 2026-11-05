import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ColdStartScreen } from './ColdStartScreen';
import { useConnectivityStore } from '../store/connectivityStore';

const healthFetch = vi.fn(async () => new Response('', { status: 503 }));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  healthFetch.mockClear();
  vi.stubGlobal('fetch', healthFetch);
  useConnectivityStore.setState({ status: 'waking', since: Date.now(), gaveUp: false });
});

afterEach(async () => {
  cleanup();
  // Đưa vòng chờ dùng chung về kết thúc trước khi bỏ fake timers, để không để lại promise treo cho test sau.
  await vi.advanceTimersByTimeAsync(200_000);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ColdStartScreen', () => {
  it('hiện thông điệp tiếng Việt với role="status" và không có nút Thử lại lúc đầu', () => {
    render(<ColdStartScreen />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Quán đang mở cửa, chờ khoảng 1 phút');
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  });

  it('sau 180 giây không thức thì hiện nút Thử lại, bấm thì chờ lại', async () => {
    render(<ColdStartScreen />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000);
    });
    const retry = screen.getByRole('button', { name: 'Thử lại' });
    const before = healthFetch.mock.calls.length;

    fireEvent.click(retry);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(healthFetch.mock.calls.length).toBeGreaterThan(before);
    expect(useConnectivityStore.getState().gaveUp).toBe(false);
  });
});
