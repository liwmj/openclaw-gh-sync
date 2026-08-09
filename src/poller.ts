export class Poller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly intervalMs: number,
    private readonly onTick: () => Promise<void>,
  ) {}

  start(): void {
    this.stopped = false;
    const loop = async (): Promise<void> => {
      if (this.stopped) return;
      try {
        await this.onTick();
      } catch {
        // surface errors via status.lastError; never kill the loop
      }
      if (!this.stopped) {
        this.timer = setTimeout(loop, this.intervalMs);
      }
    };
    this.timer = setTimeout(loop, this.intervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
