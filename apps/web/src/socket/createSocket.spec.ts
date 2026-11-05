import { beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.fn();
vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => io(...args) }));

import { createSocket } from './createSocket';

beforeEach(() => {
  io.mockReset();
  io.mockReturnValue({});
});

describe('createSocket', () => {
  it('tạo socket cùng origin, không tự autoConnect, không tự reconnect, chỉ websocket', () => {
    createSocket(() => 'tok');
    expect(io).toHaveBeenCalledTimes(1);
    const opts = io.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts).toMatchObject({ autoConnect: false, reconnection: false, transports: ['websocket'] });
  });

  it('auth là hàm đọc token mới nhất ở mỗi lần nối, không giữ token cũ', () => {
    let token: string | null = 'old';
    createSocket(() => token);
    const opts = io.mock.calls[0]?.[0] as { auth: (cb: (d: object) => void) => void };
    const seen: unknown[] = [];
    opts.auth((d) => seen.push(d));
    token = 'new';
    opts.auth((d) => seen.push(d));
    expect(seen).toEqual([{ token: 'old' }, { token: 'new' }]);
  });
});
