import { Inject, Injectable } from '@nestjs/common';
import { UuidSchema } from '@tdvh/shared';
import type { Socket } from 'socket.io';
import { AppError } from '../core/errors.js';
import { JWT_SECRET, verifyAccessToken } from '../core/jwt.js';
import { PrismaService } from '../core/prisma.service.js';
import type { SocketData } from './event-router.js';

// Connection middleware (§3.4): reads the token from handshake.auth, checks JWT and bannedAt in the DB.
@Injectable()
export class SocketAuth {
  constructor(
    @Inject(JWT_SECRET) private readonly secret: string,
    private readonly prisma: PrismaService,
  ) {}

  middleware(): (socket: Socket, next: (err?: Error) => void) => void {
    return (socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (err: unknown) => {
          // Client sees connect_error with message = code, and data.code. Unknown errors fail closed.
          const code = err instanceof AppError ? err.code : 'UNAUTHENTICATED';
          next(Object.assign(new Error(code), { data: { code } }));
        },
      );
    };
  }

  private async authenticate(socket: Socket): Promise<void> {
    const token: unknown = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string') throw new AppError('UNAUTHENTICATED');

    const { sub } = await verifyAccessToken(this.secret, token);
    if (!UuidSchema.safeParse(sub).success) throw new AppError('UNAUTHENTICATED');

    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, bannedAt: true },
    });
    if (!user || user.bannedAt !== null) throw new AppError('UNAUTHENTICATED');

    (socket.data as SocketData).userId = user.id;
  }
}
