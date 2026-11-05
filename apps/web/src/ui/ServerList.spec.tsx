import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../api/client';
import { useServerStore } from '../store/serverStore';
import { useWorldStore } from '../store/worldStore';
import { ServerList } from './ServerList';

const SERVER_A = {
  id: '00000000-0000-4000-8000-00000000000a',
  slug: 'tra-da-1',
  name: 'Vỉa Hè Số Một',
  online: 12,
  activeShops: 3,
  freePlots: 5,
  load: 'MEDIUM',
};
const SERVER_B = {
  id: '00000000-0000-4000-8000-00000000000b',
  slug: 'tra-da-2',
  name: 'Ngõ Nhỏ',
  online: 0,
  activeShops: 0,
  freePlots: 9,
  load: 'LOW',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    return key ? routes[key]!(url, init ?? {}) : json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function count(fn: ReturnType<typeof mockFetch>, suffix: string) {
  return fn.mock.calls.filter(([url]) => String(url).endsWith(suffix)).length;
}

beforeEach(() => {
  setAccessToken(null);
  useServerStore.setState({
    servers: null,
    loading: false,
    listError: null,
    joining: false,
    joinError: null,
    serverId: null,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useWorldStore.getState().disconnectWorld();
});

describe('màn chọn server', () => {
  it('hiển thị đủ tên, online, quán, plot trống, mức tải và ping chưa đo', async () => {
    mockFetch({ '/servers': () => json(200, { items: [SERVER_A] }) });
    render(<ServerList />);

    const card = (await screen.findByRole('heading', { name: 'Vỉa Hè Số Một' })).closest('article')!;
    const scope = within(card);
    expect(scope.getByText('Đang online').nextElementSibling?.textContent).toBe('12');
    expect(scope.getByText('Quán hoạt động').nextElementSibling?.textContent).toBe('3');
    expect(scope.getByText('Plot trống').nextElementSibling?.textContent).toBe('5');
    expect(scope.getByText('Mức tải').nextElementSibling?.textContent).toBe('Vừa');
    expect(scope.getByLabelText('Ping chưa đo được').textContent).toBe('—');
  });

  it('mức tải LOW và HIGH hiện đúng tiếng Việt có dấu', async () => {
    mockFetch({
      '/servers': () => json(200, { items: [SERVER_B, { ...SERVER_A, load: 'HIGH' }] }),
    });
    render(<ServerList />);

    await screen.findByRole('heading', { name: 'Ngõ Nhỏ' });
    expect(screen.getByText('Vắng')).toBeTruthy();
    expect(screen.getByText('Đông')).toBeTruthy();
  });

  it('Quick Join gọi POST /servers/quick-join và lưu serverId vào store', async () => {
    const fetchMock = mockFetch({
      '/servers': () => json(200, { items: [SERVER_A] }),
      '/servers/quick-join': () => json(200, { serverId: SERVER_B.id }),
    });
    render(<ServerList />);
    await screen.findByRole('heading', { name: 'Vỉa Hè Số Một' });

    fireEvent.click(screen.getByRole('button', { name: 'Vào nhanh (Quick Join)' }));

    await waitFor(() => expect(useServerStore.getState().serverId).toBe(SERVER_B.id));
    expect(count(fetchMock, '/servers/quick-join')).toBe(1);
    const join = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/servers/quick-join'))!;
    expect((join[1] as RequestInit).method).toBe('POST');
    expect(useWorldStore.getState().serverId).toBe(SERVER_B.id);
  });

  it('nút Vào máy chủ này lưu đúng serverId của thẻ đã chọn', async () => {
    mockFetch({ '/servers': () => json(200, { items: [SERVER_A, SERVER_B] }) });
    render(<ServerList />);
    const card = (await screen.findByRole('heading', { name: 'Ngõ Nhỏ' })).closest('article')!;

    fireEvent.click(within(card).getByRole('button', { name: 'Vào máy chủ này' }));

    expect(useServerStore.getState().serverId).toBe(SERVER_B.id);
    expect(useWorldStore.getState().serverId).toBe(SERVER_B.id);
  });

  it('SERVER_FULL từ quick join hiện đúng thông báo tiếng Việt', async () => {
    mockFetch({
      '/servers': () => json(200, { items: [SERVER_A] }),
      '/servers/quick-join': () => json(409, { error: { code: 'SERVER_FULL', message: 'full' } }),
    });
    render(<ServerList />);
    await screen.findByRole('heading', { name: 'Vỉa Hè Số Một' });

    fireEvent.click(screen.getByRole('button', { name: 'Vào nhanh (Quick Join)' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Máy chủ đã đầy. Thử máy chủ khác.');
    expect(useServerStore.getState().serverId).toBeNull();
  });

  it('không có server thì hiện trạng thái rỗng và không cho Quick Join', async () => {
    mockFetch({ '/servers': () => json(200, { items: [] }) });
    render(<ServerList />);

    expect(await screen.findByText('Chưa có máy chủ nào đang mở.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Vào nhanh (Quick Join)' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('đang tải thì hiện trạng thái tải', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockFetch({
      '/servers': async () => {
        await gate;
        return json(200, { items: [] });
      },
    });
    render(<ServerList />);

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByText('Đang tải danh sách máy chủ...')).toBeTruthy();
    release();
    expect(await screen.findByText('Chưa có máy chủ nào đang mở.')).toBeTruthy();
  });

  it('lỗi tải danh sách có nút thử lại gọi lại API', async () => {
    let calls = 0;
    mockFetch({
      '/servers': () => {
        calls += 1;
        return calls === 1
          ? json(500, { error: { code: 'INTERNAL_ERROR', message: 'x' } })
          : json(200, { items: [SERVER_A] });
      },
    });
    render(<ServerList />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Có lỗi ở quán. Thử lại sau ít phút.');
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(await screen.findByRole('heading', { name: 'Vỉa Hè Số Một' })).toBeTruthy();
    expect(calls).toBe(2);
  });

  it('không dùng dangerouslySetInnerHTML', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(import.meta.dirname, 'ServerList.tsx'), 'utf8');
    expect(src).not.toContain('dangerouslySetInnerHTML');
  });
});
