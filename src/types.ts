export interface SyncConfig {
  repo: string;
  branch: string;
  instanceName: string;
  include: string[];
  exclude: string[];
  pushDebounceMs: number;
  pollIntervalSec: number;
  backupIntervalH: number;
  backupRetain: number;
  gitCryptEnabled: boolean;
  syncStrategy: "merge" | "replace-local";
}

export interface InstanceMeta {
  name: string;
  hostname: string;
  createdAt: string;
  version: string;
}

export interface AheadBehind {
  ahead: number;
  behind: number;
}

export type PullOutcome =
  | { status: "up-to-date" }
  | { status: "ok"; changedFiles: string[] }
  | { status: "conflict" }
  | { status: "diverged" };

export interface SyncStatus {
  transport: "github";
  repo: string;
  branch: string;
  instanceName: string;
  configured: boolean;
  isSyncing: boolean;
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastBackupAt: string | null;
  lastError: string | null;
  ahead: number;
  behind: number;
  gitCrypt: "ok" | "missing" | "not-inited" | "disabled";
  conflictFiles: string[];
  backups: string[];
  pollIntervalSec: number;
  backupIntervalH: number;
}

export interface MirrorEntry {
  relative: string;
  source: string;
  target: string;
}

export interface BackupResult {
  archivePath: string;
  sizeBytes: number;
  uploadedTo: "git" | "releases";
}

export interface RestoreResult {
  snapshot: string;
  verified: boolean;
  staged: string;
  changedPaths: string[];
  applied: boolean;
}

export interface ResolveResult {
  strategy: "cleanup" | "accept-copy" | "keep";
  files: string[];
}
