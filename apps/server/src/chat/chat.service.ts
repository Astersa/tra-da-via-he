import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ChatMessage, ChatSendReq } from '@tdvh/shared';
import { CLOCK, type Clock } from '../core/clock.js';
import { AppError } from '../core/errors.js';
import { PrismaService } from '../core/prisma.service.js';
import { REALTIME_PUBLISHER, type RealtimePublisher } from '../core/realtime-publisher.js';
import { filterChat } from './chat-filter.js';

// IMPLEMENTATION-PLAN.md §3.4.2 chat:send, §5.2 I2 (M1-E4-T5). In-memory only: nothing is written to the DB.
export const CHAT_BUFFER_MAX = 50;
export const CLIENT_MSG_DEDUPE_MS = 30_000;

@Injectable()
export class ChatService {
  // serverId -> userId -> displayName. Filled by the gateway at join (read once from the profile).
  private readonly members = new Map<string, Map<string, string>>();
  // serverId -> last CHAT_BUFFER_MAX messages. Released when the last member leaves.
  private readonly buffers = new Map<string, ChatMessage[]>();
  // `${userId}:${clientMsgId}` -> id of the message it created, kept for CLIENT_MSG_DEDUPE_MS.
  private readonly sent = new Map<string, { id: string; at: number }>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(REALTIME_PUBLISHER) private readonly publisher: RealtimePublisher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  enter(serverId: string, userId: string, displayName: string): void {
    let room = this.members.get(serverId);
    if (!room) {
      room = new Map();
      this.members.set(serverId, room);
    }
    room.set(userId, displayName);
  }

  leave(serverId: string, userId: string): void {
    const room = this.members.get(serverId);
    if (room) {
      room.delete(userId);
      if (room.size === 0) {
        this.members.delete(serverId);
        this.buffers.delete(serverId);
      }
    }
    this.sweepSent(this.clock.now().getTime());
  }

  getRecent(serverId: string): ChatMessage[] {
    return [...(this.buffers.get(serverId) ?? [])];
  }

  findById(serverId: string, id: string): ChatMessage | undefined {
    return this.buffers.get(serverId)?.find((m) => m.id === id);
  }

  async send(ctx: { userId: string; serverId: string }, req: ChatSendReq): Promise<{ id: string }> {
    const displayName = this.members.get(ctx.serverId)?.get(ctx.userId);
    if (displayName === undefined) throw new AppError('SESSION_STALE');

    const now = this.clock.now().getTime();
    const user = await this.prisma.user.findUnique({ where: { id: ctx.userId }, select: { mutedUntil: true } });
    if (user?.mutedUntil && user.mutedUntil.getTime() > now) throw new AppError('CHAT_MUTED');

    this.sweepSent(now);
    const key = `${ctx.userId}:${req.clientMsgId}`;
    const prior = this.sent.get(key);
    if (prior) return { id: prior.id };

    const msg: ChatMessage = {
      id: randomUUID(),
      userId: ctx.userId,
      displayName,
      text: filterChat(req.text),
      at: new Date(now).toISOString(),
    };
    let buffer = this.buffers.get(ctx.serverId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(ctx.serverId, buffer);
    }
    buffer.push(msg);
    if (buffer.length > CHAT_BUFFER_MAX) buffer.splice(0, buffer.length - CHAT_BUFFER_MAX);
    this.sent.set(key, { id: msg.id, at: now });

    this.publisher.toServer(ctx.serverId, 'chat:message', msg);
    return { id: msg.id };
  }

  private sweepSent(now: number): void {
    for (const [key, v] of this.sent) {
      if (now - v.at > CLIENT_MSG_DEDUPE_MS) this.sent.delete(key);
    }
  }
}
