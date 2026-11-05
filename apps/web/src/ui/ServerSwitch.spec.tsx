import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, setAccessToken } from '../api/client';
import { useServerStore } from '../store/serverStore';
import { useWorldStore } from '../store/worldStore';
import { ServerSwitch } from './ServerSwitch';

const CURRENT = {
  id: '00000000-0000-4000-8000-00000000000a',
  slug: 'tra-da-1',
  name: 'Vỉa Hè Số Một',
  online: 12,
  activeShops: 3,
  freePlots: 5,
  load: 'MEDIUM',
} as const;
const OTHER = {
  id: '00000000-0000-4000-8000-00000000000b',
  slug: 'tra-da-2',
  name: 'Ngõ Nhỏ',
  online: 4,
  activeShops: 1,
  freePlots: 9,
  load: 'LOW',
} as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Danh sách REST trả về `items`; mọi lần mở đều gọi /servers.
function mockServers(items: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () => json(200, { items })));
}

function joinedAt(serverId: string) {
  useWorldStore.setState({ status: 'joined', serverId, switching: false, switchError: null });
}

beforeEach(() => {
  setAccessToken(null);
  useServerStore.setState({ servers: null, loading: false, listError: null, joining: false, joinError: null, serverId: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useWorldStore.getState().disconnectWorld();
});

describe('ServerSwitch: đổi máy chủ trong game', () => {
  it('không hiện khi chưa joined', () => {
    mockServers([CURRENT, OTHER]);
    useWorldStore.setState({ status: 'connecting', serverId: CURRENT.id });
    render(<ServerSwitch />);
    expect(screen.queryByRole('button', { name: 'Đổi máy chủ' })).toBeNull();
  });

  it('mở hộp: liệt kê máy chủ khác, không gồm máy chủ hiện tại', async () => {
    mockServers([CURRENT, OTHER]);
    joinedAt(CURRENT.id);
    render(<ServerSwitch />);
    fireEvent.click(screen.getByRole('button', { name: 'Đổi máy chủ' }));

    const dialog = await screen.findByRole('heading', { name: 'Đổi máy chủ' });
    expect(dialog).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Ngõ Nhỏ' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Vỉa Hè Số Một' })).toBeNull();
    const card = screen.getByRole('heading', { name: 'Ngõ Nhỏ' }).closest('article')!;
    expect(within(card).getByText('Đang online').nextElementSibling?.textContent).toBe('4');
  });

  it('chỉ có máy chủ hiện tại thì hiện "Chưa có máy chủ khác" và không có nút chọn', async () => {
    mockServers([CURRENT]);
    joinedAt(CURRENT.id);
    render(<ServerSwitch />);
    fireEvent.click(screen.getByRole('button', { name: 'Đổi máy chủ' }));
    expect(await screen.findByText('Chưa có máy chủ khác.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chuyển sang máy chủ này' })).toBeNull();
  });

  it('chọn máy chủ: gọi switchServer với id đích; thành công thì đóng hộp', async () => {
    mockServers([CURRENT, OTHER]);
    joinedAt(CURRENT.id);
    const switchServer = vi.fn(async () => true);
    useWorldStore.setState({ switchServer });
    render(<ServerSwitch />);
    fireEvent.click(screen.getByRole('button', { name: 'Đổi máy chủ' }));
    await screen.findByRole('heading', { name: 'Ngõ Nhỏ' });
    fireEvent.click(screen.getByRole('button', { name: 'Chuyển sang máy chủ này' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(switchServer).toHaveBeenCalledWith(OTHER.id);
  });

  it('lỗi: giữ hộp mở và hiện đúng thông báo tiếng Việt', async () => {
    mockServers([CURRENT, OTHER]);
    joinedAt(CURRENT.id);
    useWorldStore.setState({
      switchServer: async () => {
        useWorldStore.setState({ switchError: new ApiError('SERVER_FULL', 'đầy', 409) });
        return false;
      },
    });
    render(<ServerSwitch />);
    fireEvent.click(screen.getByRole('button', { name: 'Đổi máy chủ' }));
    await screen.findByRole('heading', { name: 'Ngõ Nhỏ' });
    fireEvent.click(screen.getByRole('button', { name: 'Chuyển sang máy chủ này' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Máy chủ đã đầy. Thử máy chủ khác.');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('đang chuyển thì nút chọn bị khóa để không gửi trùng', async () => {
    mockServers([CURRENT, OTHER]);
    joinedAt(CURRENT.id);
    render(<ServerSwitch />);
    fireEvent.click(screen.getByRole('button', { name: 'Đổi máy chủ' }));
    await screen.findByRole('heading', { name: 'Ngõ Nhỏ' });
    useWorldStore.setState({ switching: true });
    expect((await screen.findByRole('status')).textContent).toBe('Đang chuyển máy chủ...');
    expect((screen.getByRole('button', { name: 'Chuyển sang máy chủ này' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
