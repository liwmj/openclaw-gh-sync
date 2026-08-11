import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
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
  const parsed = JSON.parse(res.stdout) as { archive?: string; archivePath?: string };
  const archive = parsed.archivePath ?? parsed.archive;
  if (!archive) throw new Error("openclaw backup did not return an archive path");
  return archive;
}

export class BackupEngine {
  constructor(private readonly deps: BackupDeps) {}

  async backupNow(spawnFn?: SpawnFn): Promise<BackupResult | null> {
    const { backupsDir, gitops, log } = this.deps;
    mkdirSync(backupsDir, { recursive: true });
    // Bug D 修复：openclaw backup 的源路径是 stateDir（如 ~/.openclaw），
    // 输出目录不能在源路径内部，否则 openclaw 拒绝「备份输出到源路径内部」。
    // 先输出到系统临时目录（stateDir 外部），成功后再移动进 backupsDir。
    const tmpOut = mkdtempSync(join(tmpdir(), "gh-sync-backup-"));
    let archive: string;
    try {
      archive = runBackupCli(this.deps.stateDir, tmpOut, spawnFn);
    } catch (err) {
      rmSync(tmpOut, { recursive: true, force: true });
      throw err;
    }
    if (!existsSync(archive)) {
      rmSync(tmpOut, { recursive: true, force: true });
      return null;
    }
    const sizeBytes = statSync(archive).size;
    const dest = join(backupsDir, basename(archive));
    copyFileSync(archive, dest);
    rmSync(tmpOut, { recursive: true, force: true });
    const uploadedTo: BackupResult["uploadedTo"] = "git";
    await gitops.commitChanged(`Backup: ${basename(dest)}`);
    await gitops.push();
    await this.enforceRetention();
    log(`backup uploaded: ${dest}`);
    return { archivePath: dest, sizeBytes, uploadedTo };
  }

  async enforceRetention(): Promise<void> {
    const { backupsDir, gitops, retain } = this.deps;
    if (retain <= 0) return;
    const files = readdirSync(backupsDir)
      .filter((f) => f.endsWith(".tar.gz"))
      .map((f) => join(backupsDir, f));
    if (files.length <= retain) return;
    const sorted = files
      .filter((f) => { try { statSync(f); return true; } catch { return false; } })
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    const toDelete = sorted.slice(retain);
    for (const f of toDelete) unlinkSync(f);
    const changed = await gitops.commitChanged(`Backup retention: removed ${toDelete.length} old archive(s)`);
    if (changed) await gitops.push();
  }
}
