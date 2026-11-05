import { Global, Module } from '@nestjs/common';
import { CLOCK, systemClock } from './clock.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService, { provide: CLOCK, useValue: systemClock }],
  exports: [PrismaService, CLOCK],
})
export class PrismaModule {}
