import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { BackupResult } from "./types.js";

export interface SpawnResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type SpawnFn = (cmd: string, args: string[]) => SpawnResult;

export interface BackupDeps {
  stateDir: string;
  syncDir: string;
  backupsDir: string;
  retain: number;
  gitops: { commitChanged(message: string): Promise<boolean>; push(): Promise<void> };
  log: (m: string) => void;
}

export function runBackupCli(
  stateDir: string,
  outputDir: string,
  spawnFn: SpawnFn = (cmd, args) => {
    const res = spawnSync(cmd, args, { encoding: "utf8" });
    return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  },
): string {
  const res = spawnFn(process.env.GH_SYNC_BACKUP_CLI || "openclaw", ["backup", "create", "--verify", "--output", outputDir, "--json"]);
  if (res.status !== 0) throw new Error(`openclaw backup failed: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout) as { archive?: string };
  if (!parsed.archive) throw new Error("openclaw backup did not return an archive path");
  return parsed.archive;
}

export class BackupEngine {
  constructor(private readonly deps: BackupDeps) {}

  async backupNow(spawnFn?: SpawnFn): Promise<BackupResult | null> {
    const { backupsDir, gitops, log } = this.deps;
    mkdirSync(backupsDir, { recursive: true });
    const archive = runBackupCli(this.deps.stateDir, backupsDir, spawnFn);
    if (!existsSync(archive)) return null;
    const sizeBytes = statSync(archive).size;
    const uploadedTo: BackupResult["uploadedTo"] = "git";
    await gitops.commitChanged(`Backup: ${archive.split(/[\\/]/).pop() ?? archive}`);
    await gitops.push();
    await this.enforceRetention();
    log(`backup uploaded: ${archive}`);
    return { archivePath: archive, sizeBytes, uploadedTo };
  }

  async enforceRetention(): Promise<void> {
    const { backupsDir, gitops, retain } = this.deps;
    if (retain <= 0) return;
    const files = readdirSync(backupsDir)
      .filter((f) => f.endsWith(".tar.gz"))
      .map((f) => join(backupsDir, f));
    if (files.length <= retain) return;
    const sorted = files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    const toDelete = sorted.slice(retain);
    for (const f of toDelete) unlinkSync(f);
    const changed = await gitops.commitChanged(`Backup retention: removed ${toDelete.length} old archive(s)`);
    if (changed) await gitops.push();
  }
}
