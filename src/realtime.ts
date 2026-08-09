import type { SyncConfig } from "./types.js";
import { buildMirrorEntries, credentialsPath, mirrorRoot } from "./paths.js";
import { compileExcludes } from "./exclude.js";
import { copyAllToMirror, copyMirrorToSources, copyToMirror } from "./mirror.js";
import { GitOps } from "./gitops.js";
import { FileWatcher } from "./watcher.js";
import { Poller } from "./poller.js";

export interface SyncDeps {
  syncDir: string;
  stateDir: string;
  config: SyncConfig;
  gitops: GitOps;
  log: (msg: string) => void;
  onError: (err: unknown) => void;
}

export interface EngineStatus {
  isSyncing: boolean;
  lastPushAt: string | null;
  lastPullAt: string | null;
}

export async function createGitOps(config: SyncConfig, syncDir: string, credentialsFile: string | null): Promise<GitOps> {
  const ops = new GitOps(syncDir, config.repo, config.branch, credentialsFile);
  await ops.initRepo();
  return ops;
}

export class SyncEngine {
  private watcher: FileWatcher | null = null;
  private poller: Poller | null = null;
  private isSyncing = false;
  private pendingPush = false;
  private lastPushAt: string | null = null;
  private lastPullAt: string | null = null;
  private started = false;

  constructor(private readonly deps: SyncDeps) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { syncDir, stateDir, config, gitops, log } = this.deps;
    log("starting sync engine");
    await gitops.initRepo();
    const entries = buildMirrorEntries(stateDir, syncDir, config.include);
    const excluded = compileExcludes(config.exclude);
    copyAllToMirror(entries, excluded);
    await this.syncNow();

    const watchPaths = entries.map((e) => e.source);
    this.watcher = new FileWatcher(watchPaths, [syncDir, ...config.exclude], (paths) => {
      void this.onLocalChange(paths);
    }, config.pushDebounceMs);
    this.watcher.start();

    this.poller = new Poller(config.pollIntervalSec * 1000, () => this.pullNow());
    this.poller.start();
  }

  async stop(): Promise<void> {
    this.started = false;
    await this.watcher?.stop();
    this.poller?.stop();
    this.watcher = null;
    this.poller = null;
  }

  private async onLocalChange(paths: string[]): Promise<void> {
    try {
      const { syncDir, stateDir, config, gitops } = this.deps;
      const entries = buildMirrorEntries(stateDir, syncDir, config.include);
      const excluded = compileExcludes(config.exclude);
      const filtered = paths.filter((p) => !excluded(p.replace(stateDir + "/", "")));
      copyToMirror(entries, filtered, excluded);
      await this.pushNow();
    } catch (err) {
      this.deps.onError(err);
    }
  }

  async pushNow(): Promise<void> {
    if (this.isSyncing) {
      this.pendingPush = true;
      return;
    }
    this.isSyncing = true;
    try {
      const committed = await this.deps.gitops.commitChanged(`Auto-sync: ${new Date().toISOString()}`);
      if (committed) {
        await this.deps.gitops.push();
        this.lastPushAt = new Date().toISOString();
      }
    } catch (err) {
      this.deps.onError(err);
    } finally {
      this.releaseSync();
    }
  }

  private releaseSync(): void {
    this.isSyncing = false;
    if (this.pendingPush) {
      this.pendingPush = false;
      void this.pushNow();
    }
  }

  async pullNow(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      const { gitops, syncDir, stateDir, config } = this.deps;
      const outcome = await gitops.pull();
      if (outcome.status === "ok" && outcome.changedFiles.length > 0) {
        const entries = buildMirrorEntries(stateDir, syncDir, config.include);
        const excluded = compileExcludes(config.exclude);
        copyMirrorToSources(entries, excluded);
        this.lastPullAt = new Date().toISOString();
      } else if (outcome.status === "conflict") {
        this.deps.onError(new Error("merge conflict detected; run `openclaw gh-sync conflicts`"));
      }
    } catch (err) {
      this.deps.onError(err);
    } finally {
      this.releaseSync();
    }
  }

  async syncNow(): Promise<void> {
    await this.pullNow();
    await this.pushNow();
  }

  status(): EngineStatus {
    return { isSyncing: this.isSyncing, lastPushAt: this.lastPushAt, lastPullAt: this.lastPullAt };
  }
}
