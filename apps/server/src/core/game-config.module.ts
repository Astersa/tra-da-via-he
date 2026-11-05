import { Global, Module } from '@nestjs/common';
import { GAME_CONFIG, loadGameConfig } from './game-config.js';

// Global so any module can inject GAME_CONFIG without listing it. Read once from process.env.
@Global()
@Module({
  providers: [{ provide: GAME_CONFIG, useFactory: () => loadGameConfig(process.env) }],
  exports: [GAME_CONFIG],
})
export class GameConfigModule {}
