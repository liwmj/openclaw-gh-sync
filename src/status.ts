import { existsSync } from "node:fs";
import { join } from "node:path";
import { backupsDir } from "./paths.js";
import { listSnapshots } from "./restore.js";
import { findConflictFiles } from "./conflicts.js";
import type { SyncConfig, SyncStatus } from "./types.js";
import type { EngineStatus } from "./realtime.js";

export interface StatusDeps {
  config: SyncConfig | null;
  engine: { status(): EngineStatus } | null;
  gitops: { aheadBehind(): Promise<{ ahead: number; behind: number }>; statusRaw(): Promise<{ isClean(): boolean }> } | null;
  syncDir: string;
  gitCrypt: SyncStatus["gitCrypt"];
  lastBackupAt: string | null;
  lastError: string | null;
}

export async function buildStatus(deps: StatusDeps): Promise<SyncStatus> {
  const cfg = deps.config;
  const engine = deps.engine?.status();
  let ahead = 0;
  let behind = 0;
  let isSyncing = false;
  if (deps.gitops && cfg) {
    try {
      const ab = await deps.gitops.aheadBehind();
      ahead = ab.ahead;
      behind = ab.behind;
    } catch {
      ahead = 0;
      behind = 0;
    }
    isSyncing = engine?.isSyncing ?? false;
  }
  return {
    transport: "github",
    repo: cfg?.repo ?? "",
    branch: cfg?.branch ?? "",
    instanceName: cfg?.instanceName ?? "",
    configured: Boolean(cfg),
    isSyncing,
    lastPushAt: engine?.lastPushAt ?? null,
    lastPullAt: engine?.lastPullAt ?? null,
    lastBackupAt: deps.lastBackupAt,
    lastError: deps.lastError,
    ahead,
    behind,
    gitCrypt: deps.gitCrypt,
    conflictFiles: existsSync(deps.syncDir) ? findConflictFiles(deps.syncDir) : [],
    backups: listSnapshots(join(deps.syncDir, "backups")),
    pollIntervalSec: cfg?.pollIntervalSec ?? 60,
    backupIntervalH: cfg?.backupIntervalH ?? 6,
  };
}
