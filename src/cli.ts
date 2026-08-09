import { join } from "node:path";
import { ConfigService } from "./config.js";
import { stateDir, ghSyncDir, configPath, credentialsPath } from "./paths.js";
import { buildStatus } from "./status.js";
import { createGitOps, SyncEngine } from "./realtime.js";
import { BackupEngine } from "./backup.js";
import { RestoreEngine } from "./restore.js";
import { readCredentials } from "./credentials.js";
import { gitCryptAvailable } from "./gitcrypt.js";
import type { SyncStatus } from "./types.js";

export interface Runtime {
  status(): Promise<SyncStatus>;
  syncNow(): Promise<string>;
  backupNow(): Promise<string>;
  restore(opts: { snapshot?: string; fromInstance?: string; dryRun?: boolean; yes?: boolean }): Promise<string>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createRuntime(opts: { stateDir: string; env: NodeJS.ProcessEnv }): Runtime {
  const state = opts.stateDir;
  const sync = ghSyncDir(state);
  const cfgService = new ConfigService(configPath(sync));
  let engine: SyncEngine | null = null;
  let backupEngine: BackupEngine | null = null;
  let restoreEngine: RestoreEngine | null = null;
  let gitops: Awaited<ReturnType<typeof createGitOps>> | null = null;
  let lastBackupAt: string | null = null;
  let lastError: string | null = null;

  async function ensureReady(): Promise<{ cfg: NonNullable<ReturnType<ConfigService["load"]>> }> {
    const cfg = cfgService.load();
    if (!cfg || !cfgService.validate(cfg).ok) throw new Error("not configured: run `openclaw gh-sync setup`");
    const cred = readCredentials(credentialsPath(sync)) ?? null;
    gitops = await createGitOps(cfg, sync, cred);
    engine = new SyncEngine({ stateDir: state, syncDir: sync, config: cfg, gitops, log: (m) => console.log(m), onError: (e) => { lastError = String(e); } });
    backupEngine = new BackupEngine({ stateDir: state, syncDir: sync, backupsDir: join(sync, "backups"), gitops, log: (m) => console.log(m) });
    restoreEngine = new RestoreEngine({ syncDir: sync, stateDir: state, gitops, log: (m) => console.log(m) });
    return { cfg };
  }

  return {
    async status() {
      const cfg = cfgService.load();
      return buildStatus({
        config: cfg,
        engine,
        gitops,
        syncDir: sync,
        gitCrypt: gitCryptAvailable() ? "ok" : "missing",
        lastBackupAt,
        lastError,
      });
    },
    async syncNow() {
      await ensureReady();
      await engine!.syncNow();
      return "sync complete";
    },
    async backupNow() {
      await ensureReady();
      const res = await backupEngine!.backupNow();
      lastBackupAt = new Date().toISOString();
      return res ? `backup uploaded: ${res.archivePath}` : "backup failed";
    },
    async restore(o) {
      await ensureReady();
      const res = await restoreEngine!.restore(o);
      return res.applied ? `restored ${res.snapshot}` : `preview: ${res.changedPaths.length} paths`;
    },
    async start() {
      try {
        await ensureReady();
        await engine!.start();
      } catch (e) {
        lastError = String(e);
      }
    },
    async stop() {
      await engine?.stop();
    },
  };
}

export function registerCommands(ctx: { program: Record<string, (cmd: string, desc?: string) => unknown> }): void {
  void ctx;
}
