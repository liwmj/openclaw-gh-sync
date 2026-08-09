import { watch, type FSWatcher } from "chokidar";

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Set<string>();

  constructor(
    private readonly watchPaths: string[],
    private readonly ignored: string[],
    private readonly onChange: (paths: string[]) => void,
    private readonly debounceMs = 2000,
  ) {}

  start(): void {
    this.watcher = watch(this.watchPaths, {
      ignored: (p) => this.ignored.some((g) => p.includes(g)),
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });
    const schedule = (p: string): void => {
      this.pending.add(p);
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        const paths = [...this.pending];
        this.pending.clear();
        this.onChange(paths);
      }, this.debounceMs);
    };
    this.watcher.on("add", schedule).on("change", schedule).on("unlink", schedule).on("addDir", schedule).on("unlinkDir", schedule);
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    await this.watcher?.close();
    this.watcher = null;
  }
}
