import type { ServerEvent, ServerToClientEvents } from '@tdvh/shared';

// Token for the realtime publisher. Services inject this interface; only realtime/ implements it (§3.1).
export const REALTIME_PUBLISHER = 'REALTIME_PUBLISHER';

export type ServerPayload<E extends ServerEvent> = Parameters<ServerToClientEvents[E]>[0];

// Emits only after the DB transaction has committed (§3.4). Rooms: lobby, server:{id}, shop-staff:{id}, user:{id}.
export interface RealtimePublisher {
  toUser<E extends ServerEvent>(userId: string, ev: E, p: ServerPayload<E>): void;
  toServer<E extends ServerEvent>(serverId: string, ev: E, p: ServerPayload<E>): void;
  toServerExcept<E extends ServerEvent>(serverId: string, userId: string, ev: E, p: ServerPayload<E>): void;
  toShopStaff<E extends ServerEvent>(shopId: string, ev: E, p: ServerPayload<E>): void;
  toLobby<E extends ServerEvent>(ev: E, p: ServerPayload<E>): void;
  disconnectUser(userId: string, reason: string): void;
  joinShopStaff(userId: string, shopId: string): void;
  leaveShopStaff(userId: string, shopId: string): void;
}
