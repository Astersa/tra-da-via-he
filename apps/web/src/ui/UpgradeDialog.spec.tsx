import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { ERROR_TEXT } from './errorText';
import { UpgradeDialog } from './UpgradeDialog';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const GUEST = { id: USER_ID, kind: 'GUEST', username: null, role: 'PLAYER', mutedUntil: null, createdAt: '2026-01-01T00:00:00.000Z' } as const;
const REGISTERED = { ...GUEST, kind: 'REGISTERED' as const, username: 'lan_01' };
const PROFILE = { userId: USER_ID, displayName: 'Lan', avatarId: 'avatar_01' };
const AUTH_BODY = { accessToken: 'tok-2', user: REGISTERED };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Handler = (url: string) => Response | Promise<Response>;

function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    return key ? routes[key]!(url) : json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function upgradeCalls(fn: ReturnType<typeof mockFetch>) {
  return fn.mock.calls.filter(([url]) => String(url).endsWith('/auth/upgrade'));
}

function fill(username: string, password: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu'), { target: { value: confirm } });
}

function openWith(opts: { reason?: string; onSuccess?: () => void; onCancel?: () => void } = {}) {
  act(() => {
    useAuthStore.getState().openUpgrade(opts);
  });
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

describe('UpgradeDialog', () => {
  it('chỉ có tên đăng nhập, mật khẩu và nhập lại mật khẩu; không có email hay quên mật khẩu', () => {
    render(<UpgradeDialog />);
    openWith();

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText('Tên đăng nhập')).toBeTruthy();
    expect(screen.getByLabelText('Mật khẩu')).toBeTruthy();
    expect(screen.getByLabelText('Nhập lại mật khẩu')).toBeTruthy();
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: /quên/i })).toBeNull();
    expect(screen.getByText(/Xóa cookie là mất nhân vật và Xu/)).toBeTruthy();
    expect(screen.getByText(/Tên đăng nhập 3 đến 20 ký tự/)).toBeTruthy();
  });

  it('nâng cấp thành công: gửi username đã chuẩn hóa, không gửi ô nhập lại, đóng form và gọi onSuccess', async () => {
    const fn = mockFetch({
      '/auth/upgrade': () => json(200, AUTH_BODY),
      '/me': () => json(200, { user: REGISTERED, profile: PROFILE }),
    });
    const onSuccess = vi.fn();
    render(<UpgradeDialog />);
    openWith({ onSuccess });

    fill(' Lan_01 ', 'matkhau123', 'matkhau123');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const [, init] = upgradeCalls(fn)[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ username: 'lan_01', password: 'matkhau123' });
    const state = useAuthStore.getState();
    expect(state.user?.kind).toBe('REGISTERED');
    expect(state.user?.username).toBe('lan_01');
    expect(state.upgradeRequest).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lỗi USERNAME_TAKEN, ALREADY_REGISTERED, VALIDATION_FAILED, RATE_LIMITED hiện đúng tiếng Việt và giữ nội dung form', async () => {
    const cases: Array<[string, number]> = [
      ['USERNAME_TAKEN', 409],
      ['ALREADY_REGISTERED', 409],
      ['VALIDATION_FAILED', 400],
      ['RATE_LIMITED', 429],
    ];
    for (const [code, status] of cases) {
      mockFetch({ '/auth/upgrade': () => json(status, { error: { code, message: 'x' } }) });
      const onSuccess = vi.fn();
      const { unmount } = render(<UpgradeDialog />);
      openWith({ onSuccess });
      fill('lan_01', 'matkhau123', 'matkhau123');
      fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(ERROR_TEXT[code as keyof typeof ERROR_TEXT]);
      expect((screen.getByLabelText('Tên đăng nhập') as HTMLInputElement).value).toBe('lan_01');
      expect((screen.getByLabelText('Mật khẩu') as HTMLInputElement).value).toBe('matkhau123');
      expect(onSuccess).not.toHaveBeenCalled();
      expect(useAuthStore.getState().upgradeRequest).not.toBeNull();
      unmount();
      useAuthStore.setState({ upgradeRequest: null });
      cleanup();
    }
  });

  it('không log mật khẩu ra console khi lỗi', async () => {
    mockFetch({ '/auth/upgrade': () => json(409, { error: { code: 'USERNAME_TAKEN', message: 'x' } }) });
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'debug'),
    ];
    render(<UpgradeDialog />);
    openWith();
    fill('lan_01', 'bimat-12345', 'bimat-12345');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    await screen.findByRole('alert');

    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain('bimat-12345');
      }
    }
  });

  it('mật khẩu nhập lại không khớp thì không gửi lên server', async () => {
    const fn = mockFetch({ '/auth/upgrade': () => json(200, AUTH_BODY) });
    render(<UpgradeDialog />);
    openWith();
    fill('lan_01', 'matkhau123', 'matkhau124');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Mật khẩu nhập lại chưa khớp.');
    expect(upgradeCalls(fn)).toHaveLength(0);
  });

  it('tên đăng nhập hoặc mật khẩu sai quy tắc thì báo tại form và không gửi', async () => {
    const fn = mockFetch({ '/auth/upgrade': () => json(200, AUTH_BODY) });
    render(<UpgradeDialog />);
    openWith();
    fill('ab', 'matkhau123', 'matkhau123');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    expect((await screen.findByRole('alert')).textContent).toContain('chưa đúng quy tắc');

    fill('lan_01', 'ngan', 'ngan');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    expect((await screen.findByRole('alert')).textContent).toContain('chưa đúng quy tắc');
    expect(upgradeCalls(fn)).toHaveLength(0);
  });

  it('gửi hai lần khi đang chờ server thì chỉ gọi API một lần', async () => {
    let release: (res: Response) => void = () => undefined;
    const fn = mockFetch({
      '/auth/upgrade': () => new Promise<Response>((resolve) => (release = resolve)),
      '/me': () => json(200, { user: REGISTERED, profile: PROFILE }),
    });
    const onSuccess = vi.fn();
    render(<UpgradeDialog />);
    openWith({ onSuccess });
    fill('lan_01', 'matkhau123', 'matkhau123');
    const form = screen.getByRole('button', { name: 'Tạo tài khoản' }).closest('form')!;
    fireEvent.submit(form);
    const pending = await screen.findByRole('button', { name: 'Đang tạo...' });
    expect(pending.hasAttribute('disabled')).toBe(true);
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(upgradeCalls(fn)).toHaveLength(1);
    release(json(200, AUTH_BODY));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it('đóng bằng "Để sau" thì gọi onCancel, không gọi onSuccess, không gọi API', async () => {
    const fn = mockFetch({ '/auth/upgrade': () => json(200, AUTH_BODY) });
    const onSuccess = vi.fn();
    const onCancel = vi.fn();
    render(<UpgradeDialog />);
    openWith({ onSuccess, onCancel });

    fireEvent.click(screen.getByRole('button', { name: 'Để sau' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(upgradeCalls(fn)).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('nhấn Esc thì đóng như "Để sau"', () => {
    const onCancel = vi.fn();
    render(<UpgradeDialog />);
    openWith({ onCancel });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('không hiện gì khi chưa có yêu cầu mở', () => {
    render(<UpgradeDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
