import type { Ack, ClientToServerEvents } from '@tdvh/shared';
import type { TypedSocket } from './createSocket';

// Event có ack. player:move không có ack nên bị loại.
export type AckEvent = Exclude<keyof ClientToServerEvents, 'player:move'>;
type Req<K extends AckEvent> = Parameters<ClientToServerEvents[K]>[0];
type Data<K extends AckEvent> = Parameters<Parameters<ClientToServerEvents[K]>[1]>[0] extends Ack<infer D>
  ? D
  : never;

export interface AckOpts {
  timeoutMs: number;
  // Chỉ thử lại khi hết thời gian chờ (không có ack). Lỗi từ server không thử lại tự động.
  retries: 0 | 2;
}

interface LooseEmitter {
  emit(event: string, ...args: unknown[]): unknown;
}

function sendOnce(socket: TypedSocket, event: string, req: unknown, timeoutMs: number): Promise<Ack<unknown> | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(null);
    }, timeoutMs);
    (socket as unknown as LooseEmitter).emit(event, req, (res: Ack<unknown>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(res);
    });
  });
}

// Gửi event có ack. Hết giờ trả về lỗi INTERNAL_ERROR retryable (phía client), không ném exception.
export async function emitAck<K extends AckEvent>(
  socket: TypedSocket,
  event: K,
  req: Req<K>,
  opts: AckOpts,
): Promise<Ack<Data<K>>> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await sendOnce(socket, event, req, opts.timeoutMs);
    if (res !== null) return res as Ack<Data<K>>;
    if (attempt >= opts.retries) break;
  }
  return {
    ok: false,
    error: { code: 'INTERNAL_ERROR', message: 'Hết thời gian chờ', retryable: true },
  };
}
