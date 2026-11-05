import { Injectable, Logger } from '@nestjs/common';

// IMPLEMENTATION-PLAN.md §3.10.4 (M1-E3-T5). Work that must finish before the process listens.
// Tasks run one after another in ascending `order`; ties keep registration order. A failing task
// is logged and rethrown, so the caller (startApp, M1-E6-T1) can exit with a non-zero code.
export type BootTaskFn = (now: Date) => Promise<void>;

interface BootTask {
  order: number;
  name: string;
  fn: BootTaskFn;
  seq: number;
}

@Injectable()
export class BootTasks {
  private readonly logger = new Logger('BootTasks');
  private readonly tasks: BootTask[] = [];

  register(order: number, name: string, fn: BootTaskFn): void {
    this.tasks.push({ order, name, fn, seq: this.tasks.length });
  }

  async run(now: Date): Promise<void> {
    const sorted = [...this.tasks].sort((x, y) => x.order - y.order || x.seq - y.seq);
    for (const task of sorted) {
      try {
        await task.fn(now);
      } catch (err) {
        this.logger.error(`boot task ${task.name} failed`, err instanceof Error ? err.stack : String(err));
        throw err;
      }
    }
  }
}
