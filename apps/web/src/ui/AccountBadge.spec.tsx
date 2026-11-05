import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { AccountBadge, GUEST_WARNING, LogoutButton } from './AccountBadge';
import { UpgradeDialog } from './UpgradeDialog';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const GUEST = { id: USER_ID, kind: 'GUEST', username: null, role: 'PLAYER', mutedUntil: null, createdAt: '2026-01-01T00:00:00.000Z' } as const;
const REGISTERED = { ...GUEST, kind: 'REGISTERED' as const, username: 'lan_01' };
const PROFILE = { userId: USER_ID, displayName: 'Lan', avatarId: 'avatar_01' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockFetch(routes: Record<string, () => Response>) {
  const fn = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    return key ? routes[key]!() : json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function callsTo(fn: ReturnType<typeof mockFetch>, suffix: string) {
  return fn.mock.calls.filter(([url]) => String(url).endsWith(suffix));
}

beforeEach(() => {
  setAccessToken(null);
  useAuthStore.setState({
    status: 'signed-in',
    user: GUEST,
    profile: PROFILE,
    accessToken: null,
    upgradeRequest: null,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AccountBadge trên HUD', () => {
  it('khách thấy cảnh báo mất nhân vật và nút tạo tài khoản', () => {
    render(<AccountBadge />);
    expect(screen.getByText(GUEST_WARNING)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tạo tài khoản' })).toBeTruthy();
  });

  it('người đã có tài khoản không thấy nút hay cảnh báo', () => {
    useAuthStore.setState({ user: REGISTERED });
    const { container } = render(<AccountBadge />);
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('button', { name: 'Tạo tài khoản' })).toBeNull();
  });

  it('bấm "Tạo tài khoản" mở form; nâng cấp xong cảnh báo và nút biến mất', async () => {
    mockFetch({
      '/auth/upgrade': () => json(200, { accessToken: 'tok-2', user: REGISTERED }),
      '/me': () => json(200, { user: REGISTERED, profile: PROFILE }),
    });
    render(
      <>
        <AccountBadge />
        <UpgradeDialog />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: 'lan_01' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'matkhau123' } });
    fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu'), { target: { value: 'matkhau123' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Tạo tài khoản' }));

    await waitFor(() => expect(screen.queryByText(GUEST_WARNING)).toBeNull());
    expect(screen.queryByRole('button', { name: 'Tạo tài khoản' })).toBeNull();
    expect(useAuthStore.getState().user?.kind).toBe('REGISTERED');
  });
});

describe('đăng xuất', () => {
  it('khách bấm Đăng xuất phải xác nhận lại với cùng cảnh báo', async () => {
    const fn = mockFetch({ '/auth/logout': () => new Response(null, { status: 204 }) });
    render(<LogoutButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(screen.getByText(GUEST_WARNING)).toBeTruthy();
    expect(callsTo(fn, '/auth/logout')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Ở lại' }));
    expect(screen.queryByText(GUEST_WARNING)).toBeNull();
    expect(callsTo(fn, '/auth/logout')).toHaveLength(0);
    expect(useAuthStore.getState().status).toBe('signed-in');

    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vẫn đăng xuất' }));

    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'));
    expect(callsTo(fn, '/auth/logout')).toHaveLength(1);
  });

  it('người đã có tài khoản bấm Đăng xuất thì đăng xuất luôn, không hỏi lại', async () => {
    useAuthStore.setState({ user: REGISTERED });
    const fn = mockFetch({ '/auth/logout': () => new Response(null, { status: 204 }) });
    render(<LogoutButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));

    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'));
    expect(callsTo(fn, '/auth/logout')).toHaveLength(1);
    expect(screen.queryByText(GUEST_WARNING)).toBeNull();
  });
});
