// IMPLEMENTATION-PLAN.md §3.4 (ServerContext), built from socket.data, never from the payload.
export interface ServerContext {
  serverId: string;
  userId: string;
  sessionId: string;
}
