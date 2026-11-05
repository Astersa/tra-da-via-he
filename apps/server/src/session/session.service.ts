import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../core/clock.js';
import type { Tx } from '../core/tx.js';
import { PrismaService } from '../core/prisma.service.js';
import type { PrismaClient, ServerSession, SessionEndReason } from '../generated/prisma/client.js';
import type { ServerContext } from './server-context.js';

// IMPLEMENTATION-PLAN.md §3.5.2, §3.5.3, §3.6.1 (M1-E3-T3). Stub: bodies are filled in next commit.
export interface EndedSession {
  id: string;
  serverId: string;
}

export interface JoinResult {
  session: ServerSession;
  ended?: EndedSession;
  reused: boolean;
}

export interface SwitchResult {
  session: ServerSession;
  ended: EndedSession;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async join(_userId: string, _serverId: string, _resumeSessionId?: string): Promise<JoinResult> {
    throw new Error('not implemented');
  }

  async leave(_userId: string, _sessionId: string, _reason: SessionEndReason): Promise<void> {
    throw new Error('not implemented');
  }

  async switchTo(_userId: string, _currentSessionId: string, _targetServerId: string): Promise<SwitchResult> {
    throw new Error('not implemented');
  }

  async endAllOnBoot(): Promise<number> {
    throw new Error('not implemented');
  }

  async assertSessionActive(_tx: Tx, _ctx: ServerContext): Promise<void> {
    throw new Error('not implemented');
  }
}
