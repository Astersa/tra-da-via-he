import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@tdvh/shared';

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Kết nối cùng origin (§3.4). Không tự reconnect: store tự refresh token rồi nối lại,
// nên `reconnection: false`. `auth` là hàm để mỗi lần nối đọc token mới nhất.
export function createSocket(getToken: () => string | null): TypedSocket {
  return io({
    autoConnect: false,
    reconnection: false,
    transports: ['websocket'],
    auth: (cb) => cb({ token: getToken() }),
  }) as TypedSocket;
}
