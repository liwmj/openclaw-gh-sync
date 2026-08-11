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

// 方案 A：自定义轻量备份，只打包核心资产（workspace + memory + 根级配置），
// 不再调用 openclaw backup create（官方全量备份 ~/.openclaw 达 1GB，含 tools/extensions/npm
// 等可重装内容，体积大导致 push 不稳、仓库膨胀）。
const BACKUP_ITEMS = ["workspace", "memory", "openclaw.json"];

export function createCustomArchive(
  stateDir: string,
  outputDir: string,
  spawnFn: SpawnFn = (cmd, args) => {
    const res = spawnSync(cmd, args, { encoding: "utf8" });
    return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  },
): string {
  mkdirSync(outputDir, { recursive: true });
  const name = `gh-sync-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`;
  const archive = join(outputDir, name);
  const items = BACKUP_ITEMS.filter((rel) => existsSync(join(stateDir, rel)));
  const res = spawnFn("tar", ["-czf", archive, "-C", stateDir, ...items]);
  if (res.status !== 0) throw new Error(`backup archive failed: ${res.stderr}`);
  if (!existsSync(archive)) throw new Error("backup archive was not created");
  return archive;
}

export class BackupEngine {
  constructor(private readonly deps: BackupDeps) {}

  // 备份 push 的是大文件（全量 ~68MB tar.gz），网络抖动时一次失败直接抛错体验差。
  // 加最多 3 次重试，间隔递增（2s/5s/10s），重试仍失败才抛出。
  private async pushWithRetry(): Promise<void> {
    const { gitops, log } = this.deps;
    const delays = [2000, 5000, 10000];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        await gitops.push();
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < delays.length) {
          log(`[gh-sync] backup push failed (attempt ${attempt + 1}), retrying in ${delays[attempt] / 1000}s: ${String(err)}`);
          await new Promise((r) => setTimeout(r, delays[attempt]));
        }
      }
    }
    throw lastErr;
  }

  async backupNow(spawnFn?: SpawnFn): Promise<BackupResult | null> {
    const { backupsDir, gitops, log } = this.deps;
    mkdirSync(backupsDir, { recursive: true });
    // 方案 A：自定义轻量备份。先输出到系统临时目录，成功后再移动进 backupsDir。
    const tmpOut = mkdtempSync(join(tmpdir(), "gh-sync-backup-"));
    let archive: string;
    try {
      archive = createCustomArchive(this.deps.stateDir, tmpOut, spawnFn);
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
    await this.pushWithRetry();
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
    if (changed) await this.pushWithRetry();
  }
}
