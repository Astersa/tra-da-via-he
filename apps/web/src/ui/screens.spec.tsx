import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { AuthGate } from './AuthGate';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const ME_BODY = {
  user: { id: USER_ID, kind: 'GUEST', username: null, role: 'PLAYER', mutedUntil: null, createdAt: '2026-01-01T00:00:00.000Z' },
  profile: { userId: USER_ID, displayName: 'Lan', avatarId: 'avatar_01' },
};
const AUTH_BODY = { accessToken: 'tok-1', user: ME_BODY.user };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const UNAUTH = () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });

type Handler = (url: string) => Response | Promise<Response>;

function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    return key ? routes[key]!(url) : json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function count(fn: ReturnType<typeof mockFetch>, suffix: string) {
  return fn.mock.calls.filter(([url]) => String(url).endsWith(suffix)).length;
}

beforeEach(() => {
  setAccessToken(null);
  useAuthStore.setState({ status: 'booting', user: null, profile: null, accessToken: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('màn vào', () => {
  it('lỗi từ API hiện đúng tiếng Việt trong thông báo role alert', async () => {
    mockFetch({
      '/auth/refresh': UNAUTH,
      '/auth/guest': () => json(409, { error: { code: 'DISPLAY_NAME_TAKEN', message: 'taken' } }),
    });
    render(<AuthGate />);
    const button = await screen.findByRole('button', { name: 'Vào uống trà đá' });
    fireEvent.change(screen.getByLabelText('Tên của bạn'), { target: { value: 'Lan' } });
    fireEvent.click(button);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Tên này đã có người dùng. Chọn tên khác nhé.');
  });

  it('bootstrap có cookie hợp lệ thì bỏ qua màn vào', async () => {
    mockFetch({
      '/auth/refresh': () => json(200, { accessToken: 'tok-boot' }),
      '/me': () => json(200, ME_BODY),
    });
    render(<AuthGate />);

    expect(await screen.findByText('Xin chào, Lan!')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Vào uống trà đá' })).toBeNull();
  });

  it('chặn gửi trùng: chỉ một lệnh POST /auth/guest và nút ở trạng thái đang gửi', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = mockFetch({
      '/auth/refresh': UNAUTH,
      '/auth/guest': async () => {
        await gate;
        return json(201, AUTH_BODY);
      },
      '/me': () => json(200, ME_BODY),
    });
    render(<AuthGate />);
    await screen.findByRole('button', { name: 'Vào uống trà đá' });
    fireEvent.change(screen.getByLabelText('Tên của bạn'), { target: { value: 'Lan' } });

    const form = screen.getByRole('button', { name: 'Vào uống trà đá' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    const pending = await screen.findByRole('button', { name: 'Đang vào...' });
    expect(pending.hasAttribute('disabled')).toBe(true);
    expect(count(fetchMock, '/auth/guest')).toBe(1);

    release();
    expect(await screen.findByText('Xin chào, Lan!')).toBeTruthy();
    expect(count(fetchMock, '/auth/guest')).toBe(1);
  });

  it('access token không nằm trong localStorage hay sessionStorage', async () => {
    mockFetch({
      '/auth/refresh': UNAUTH,
      '/auth/guest': () => json(201, AUTH_BODY),
      '/me': () => json(200, ME_BODY),
    });
    render(<AuthGate />);
    await screen.findByRole('button', { name: 'Vào uống trà đá' });
    fireEvent.change(screen.getByLabelText('Tên của bạn'), { target: { value: 'Lan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vào uống trà đá' }));
    await screen.findByText('Xin chào, Lan!');

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(useAuthStore.getState().accessToken).toBe('tok-1');
  });

  it('có bốn nhân vật là ảnh có nhãn; không có link, không có email, không có đăng ký', async () => {
    mockFetch({ '/auth/refresh': UNAUTH });
    render(<AuthGate />);
    await screen.findByRole('button', { name: 'Vào uống trà đá' });

    const avatars = screen.getAllByRole('img');
    expect(avatars.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Nhân vật 1', 'Nhân vật 2', 'Nhân vật 3', 'Nhân vật 4',
    ]);
    expect(screen.queryByRole('link')).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/email|đăng ký/i);
  });
});

describe('màn đăng nhập', () => {
  it('có dòng nhờ admin đặt lại mật khẩu, không có link quên mật khẩu', async () => {
    mockFetch({ '/auth/refresh': UNAUTH });
    render(<AuthGate />);
    fireEvent.click(await screen.findByRole('button', { name: 'Đã có tài khoản? Đăng nhập' }));

    expect(screen.getByText('Quên mật khẩu thì nhờ admin đặt lại.')).toBeTruthy();
    expect(screen.getByLabelText('Tên đăng nhập')).toBeTruthy();
    expect(screen.getByLabelText('Mật khẩu')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/quên mật khẩu\?/i)).toBeNull();
  });

  it('sai mật khẩu hiện INVALID_CREDENTIALS bằng tiếng Việt', async () => {
    mockFetch({
      '/auth/refresh': UNAUTH,
      '/auth/login': () => json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'x' } }),
    });
    render(<AuthGate />);
    fireEvent.click(await screen.findByRole('button', { name: 'Đã có tài khoản? Đăng nhập' }));
    fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: 'lan' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'sai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Sai tên đăng nhập hoặc mật khẩu.');
  });
});

describe('vùng tạm sau khi vào', () => {
  it('đăng xuất quay về màn vào', async () => {
    mockFetch({
      '/auth/refresh': () => json(200, { accessToken: 'tok-boot' }),
      '/me': () => json(200, ME_BODY),
      '/auth/logout': () => new Response(null, { status: 204 }),
    });
    render(<AuthGate />);
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng xuất' }));
    // Khách phải xác nhận lại trước khi đăng xuất.
    fireEvent.click(screen.getByRole('button', { name: 'Vẫn đăng xuất' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Vào uống trà đá' })).toBeTruthy(),
    );
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
