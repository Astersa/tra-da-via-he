import { Module } from '@nestjs/common';
import { HealthController } from './core/health.controller.js';

@Module({
  imports: [],
  controllers: [HealthController],
})
export class AppModule {}
