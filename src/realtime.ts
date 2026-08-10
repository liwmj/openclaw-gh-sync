import type { SyncConfig } from "./types.js";
import { join } from "node:path";
import { buildMirrorEntries, credentialsPath, mirrorRoot } from "./paths.js";
import { compileExcludes } from "./exclude.js";
import { copyAllToMirror, copyMirrorToSources, copyToMirror } from "./mirror.js";
import { GitOps } from "./gitops.js";
import { FileWatcher } from "./watcher.js";
import { Poller } from "./poller.js";
import { rmSync, existsSync, unlinkSync } from "node:fs";
import type { MirrorEntry } from "./types.js";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`operation timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

function cleanMirror(entries: MirrorEntry[]): void {
  for (const entry of entries) {
    try { rmSync(entry.target, { recursive: true, force: true }); } catch {}
  }
}

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

export async function createGitOps(config: SyncConfig, syncDir: string, pat: string | null): Promise<GitOps> {
  const ops = new GitOps(syncDir, config.repo, config.branch, pat);
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
  private lock = Promise.resolve();

  constructor(private readonly deps: SyncDeps) {}

  private async acquireLock(): Promise<() => void> {
    let release: () => void;
    const prev = this.lock;
    this.lock = new Promise<void>((resolve) => { release = resolve; });
    await prev;
    return release!;
  }

  async start(): Promise<void> {
    const unlock = await this.acquireLock();
    try {
      if (this.started) return;
      this.started = true;
      try {
        const { syncDir, stateDir, config, gitops, log } = this.deps;
        log("starting sync engine");
        await withTimeout(gitops.initRepo(), 60_000);
        const entries = buildMirrorEntries(stateDir, syncDir, config.include);
        const excluded = compileExcludes(config.exclude);
        cleanMirror(entries);
        copyAllToMirror(entries, excluded);
        await this.syncNow();

        const watchPaths = entries.map((e) => e.source);
        this.watcher = new FileWatcher(watchPaths, [syncDir, ...config.exclude], (paths) => {
          void this.onLocalChange(paths);
        }, config.pushDebounceMs);
        this.watcher.start();

        this.poller = new Poller(config.pollIntervalSec * 1000, () => this.pullNow());
        this.poller.start();
      } catch (err) {
        this.started = false;
        await this.watcher?.stop();
        this.watcher = null;
        this.poller = null;
        throw err;
      }
    } finally {
      unlock();
    }
  }

  async stop(): Promise<void> {
    const unlock = await this.acquireLock();
    try {
      this.started = false;
      await this.watcher?.stop();
      this.poller?.stop();
      this.watcher = null;
      this.poller = null;
    } finally {
      unlock();
    }
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
      this.deps.log("[gh-sync] pushing...");
      const committed = await withTimeout(this.deps.gitops.commitChanged(`Auto-sync: ${new Date().toISOString()}`), 30_000);
      if (committed) {
        await withTimeout(this.deps.gitops.push(), 60_000);
        this.lastPushAt = new Date().toISOString();
        this.deps.log("[gh-sync] push completed");
      }
    } catch (err) {
      this.deps.log(`[gh-sync] push failed: ${String(err)}`);
      try { unlinkSync(join(this.deps.syncDir, ".git", "index.lock")); } catch {}
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
      const outcome = await withTimeout(gitops.pull(), 60_000);
      if (outcome.status === "ok" && outcome.changedFiles.length > 0) {
        const { stateDir: sd, syncDir: syD, config: cfg } = this.deps;
        const entries = buildMirrorEntries(sd, syD, cfg.include);
        const excluded = compileExcludes(cfg.exclude);
        const mirrorRoot = entries[0]?.target ?? syD;
        const deleted = outcome.changedFiles.filter((f) => !existsSync(join(mirrorRoot, f)));
        copyMirrorToSources(entries, excluded, deleted);
        this.lastPullAt = new Date().toISOString();
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
