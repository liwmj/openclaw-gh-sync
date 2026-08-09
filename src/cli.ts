import { join } from "node:path";
import { ConfigService } from "./config.js";
import { stateDir, ghSyncDir, configPath, credentialsPath } from "./paths.js";
import { buildStatus } from "./status.js";
import { createGitOps, SyncEngine } from "./realtime.js";
import { BackupEngine } from "./backup.js";
import { RestoreEngine } from "./restore.js";
import { readCredentials, writeCredentials, extractPat } from "./credentials.js";
import { gitCryptAvailable } from "./gitcrypt.js";
import { runSetupWizard } from "./setup.js";
import { findConflictFiles } from "./conflicts.js";
import type { SyncStatus } from "./types.js";

export interface Runtime {
  status(): Promise<SyncStatus>;
  syncNow(): Promise<string>;
  pushNow(): Promise<string>;
  pullNow(): Promise<string>;
  backupNow(): Promise<string>;
  restore(opts: { snapshot?: string; fromInstance?: string; dryRun?: boolean; yes?: boolean }): Promise<string>;
  start(): Promise<void>;
  stop(): Promise<void>;
  conflicts(): Promise<string>;
  setup(): Promise<string>;
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
    if (engine && gitops && backupEngine && restoreEngine) return { cfg };
    const cred = readCredentials(credentialsPath(sync));
    const pat = cred ? extractPat(cred.trim()) : null;
    gitops = await createGitOps(cfg, sync, pat);
    engine = new SyncEngine({ stateDir: state, syncDir: sync, config: cfg, gitops, log: (m) => console.log(m), onError: (e) => { lastError = String(e); } });
    backupEngine = new BackupEngine({ stateDir: state, syncDir: sync, backupsDir: join(sync, "backups"), retain: cfg.backupRetain, gitops, log: (m) => console.log(m) });
    restoreEngine = new RestoreEngine({ syncDir: sync, stateDir: state, gitops, ownBranch: cfg.branch, log: (m) => console.log(m) });
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
      if (!res) return "backup failed";
      lastBackupAt = new Date().toISOString();
      return `backup uploaded: ${res.archivePath}`;
    },
    async restore(o) {
      await ensureReady();
      const res = await restoreEngine!.restore(o);
      return res.applied ? `restored ${res.snapshot}` : `preview: ${res.changedPaths.length} paths`;
    },
    async start() {
      try {
        const { cfg } = await ensureReady();
        if (cfg.syncStrategy === "replace-local" && gitops) {
          try {
            if (await gitops.fetchBranch(cfg.branch)) {
              await restoreEngine!.restore({ fromInstance: cfg.instanceName, yes: true });
            }
          } catch { /* remote unreachable or no data — proceed normally */ }
          cfg.syncStrategy = "merge";
          cfgService.save(cfg);
        }
        await engine!.start();
      } catch (e) {
        lastError = String(e);
      }
    },
    async stop() {
      try {
        await engine?.stop();
      } catch {
        // engine cleanup failed — still null references
      }
      engine = null;
      backupEngine = null;
      restoreEngine = null;
      gitops = null;
    },
    async pushNow() {
      await ensureReady();
      await engine!.pushNow();
      return "push complete";
    },
    async pullNow() {
      await ensureReady();
      await engine!.pullNow();
      return "pull complete";
    },
    async conflicts() {
      await ensureReady();
      const files = findConflictFiles(sync);
      return files.length ? files.join("\n") : "no conflicts";
    },
    async setup() {
      const { text, select, confirm } = await import("@clack/prompts");
      const result = await runSetupWizard({
        prompts: { text, confirm, select },
        io: {
          stateDir: state,
          syncDir: sync,
          configService: new ConfigService(configPath(sync)),
          gitCryptAvailable,
          writeCredentials,
          hasRemoteInstance: async (_repo: string, pat: string, branch: string): Promise<boolean> => {
            try {
              const base = /^https?:\/\//i.test(_repo) ? _repo : `https://github.com/${_repo.replace(/^\/+/, "").replace(/^github\.com\//, "")}`;
              const url = base.replace(/\.git$/, "").replace("https://", `https://x-access-token:${encodeURIComponent(pat)}@`);
              const { execFileSync } = await import("node:child_process");
              const out = execFileSync("git", ["ls-remote", "--heads", url, `refs/heads/${branch}`], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });
              return out.trim().length > 0;
            } catch {
              return false;
            }
          },
        },
      });
      return `setup complete: instance ${result.instanceName} on branch ${result.branch}`;
    },
  };
}

export interface CommanderProgram {
  command(nameAndArgs: string): CommanderCommand;
}

export interface CommanderCommand {
  command(nameAndArgs: string): CommanderCommand;
  description(text: string): CommanderCommand;
  option(flags: string, desc: string): CommanderCommand;
  action(fn: (...args: unknown[]) => void | Promise<void>): void;
}

let commandsRegistered = false;

export function registerCommands(program: CommanderProgram, rt: Runtime): void {
  if (commandsRegistered) return;
  commandsRegistered = true;

  const ghSync = program.command("gh-sync").description("OpenClaw GitHub sync and backup");

  ghSync.command("status").description("Show config status, sync timestamps, ahead/behind, conflicts").action(async () => {
    const s = await rt.status();
    console.log(JSON.stringify(s, null, 2));
  });

  ghSync.command("push").description("Force a push cycle immediately").action(async () => {
    console.log(await rt.pushNow());
  });

  ghSync.command("pull").description("Force a pull cycle immediately").action(async () => {
    console.log(await rt.pullNow());
  });

  ghSync.command("sync").description("Force a full sync cycle (pull + push)").action(async () => {
    console.log(await rt.syncNow());
  });

  ghSync.command("backup").description("Create and upload a backup archive now").action(async () => {
    console.log(await rt.backupNow());
  });

  ghSync.command("restore [snapshot]")
    .description("Restore from a backup snapshot")
    .option("--dry-run", "Preview what the restore would change")
    .option("--yes", "Apply the restore without confirmation")
    .action((...args: unknown[]) => {
      const snapshot = typeof args[0] === "string" ? args[0] : undefined;
      const opts = (args[args.length - 1] as { dryRun?: boolean; yes?: boolean } | undefined) ?? {};
      void (async () => {
        console.log(await rt.restore({ snapshot, dryRun: opts.dryRun, yes: opts.yes }));
      })();
    });

  ghSync.command("conflicts").description("List active merge conflicts").action(async () => {
    console.log(await rt.conflicts());
  });

  ghSync.command("setup").description("Interactive first-time configuration").action(async () => {
    console.log(await rt.setup());
  });
}
