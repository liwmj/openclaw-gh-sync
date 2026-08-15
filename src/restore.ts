import { copyFileSync, cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import type { RestoreResult } from "./types.js";

export interface RestoreDeps {
  syncDir: string;
  stateDir: string;
  gitops: {
    ensureBranch(name: string): Promise<void>;
    fetchBranch(branch: string, timeoutMs?: number): Promise<boolean>;
    commitChanged(message: string): Promise<boolean>;
    pushCurrent(): Promise<void>;
  };
  ownBranch: string;
  fetchTimeoutMs?: number;
  log: (m: string) => void;
}

export function listSnapshots(backupsDir: string): string[] {
  if (!existsSync(backupsDir)) return [];
  return readdirSync(backupsDir).filter((f) => f.endsWith(".tar.gz"));
}

// 方案 A：自定义轻量备份格式（tar.gz 含 workspace/memory/openclaw.json），
// 不再依赖 openclaw backup verify，改用 tar 列表校验。
export function verifyArchive(archivePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const res = spawnSync("tar", ["-tzf", archivePath], { stdio: "ignore" });
    resolve(res.status === 0);
  });
}

export class RestoreEngine {
  constructor(private readonly deps: RestoreDeps) {}

  async restore(opts: {
    snapshot?: string;
    fromInstance?: string;
    dryRun?: boolean;
    yes?: boolean;
  }): Promise<RestoreResult> {
    const { stateDir, syncDir, gitops } = this.deps;
    if (opts.snapshot && opts.fromInstance) {
      throw new Error("snapshot and fromInstance are mutually exclusive");
    }
    let archive: string | null = opts.snapshot
      ? join(syncDir, "backups", opts.snapshot)
      : latestLocal(join(syncDir, "backups"));
    if (opts.fromInstance) {
      const branch = `instances/${opts.fromInstance}`;
      // 慢网络下跨实例 fetch 可超 30s（实测 ~170s）：用更宽松的超时，避免误判网络错误
      const fetchTimeoutMs =
        this.deps.fetchTimeoutMs ?? Math.max((this.deps as { gitTimeoutMs?: number }).gitTimeoutMs ?? 30_000, 180_000);
      if (!(await gitops.fetchBranch(branch, fetchTimeoutMs))) {
        throw new Error(`no remote instance: ${opts.fromInstance}`);
      }
      await gitops.ensureBranch(branch);
      const remoteArchive = latestLocal(join(syncDir, "backups"));
      if (!remoteArchive) {
        await gitops.ensureBranch(this.deps.ownBranch);
        throw new Error("no snapshot available");
      }
      const tmpDir = mkdtempSync(join(tmpdir(), "openclaw-restore-archive-"));
      const tmpArchive = join(tmpDir, remoteArchive.split(/[\\/]/).pop()!);
      copyFileSync(remoteArchive, tmpArchive);
      await gitops.ensureBranch(this.deps.ownBranch);
      archive = tmpArchive;
    }
    if (!archive || !existsSync(archive)) throw new Error("no snapshot available");
    const verified = await verifyArchive(archive);
    const staging = mkdtempSync(join(tmpdir(), "openclaw-restore-"));
    const tmpArchiveDir = opts.fromInstance ? archive.replace(/[\\/][^\\/]+$/, "") : null;
    try {
      const res = spawnSync("tar", ["-xzf", archive, "-C", staging], { stdio: "ignore" });
      if (res.status !== 0) throw new Error("archive extraction failed");
      const changedPaths = walkForPreview(staging);
      if (opts.dryRun) return { snapshot: archive, verified, staged: staging, changedPaths, applied: false };
      if (!opts.yes) throw new Error("pass --yes to apply, or use --dry-run to preview");
      if (!verified) throw new Error(`archive failed verification: ${archive}`);
      copyStagingToState(staging, stateDir);
      this.deps.log(`restored ${archive}`);
      if (await gitops.commitChanged(`Restore: ${archive.split(/[\\/]/).pop() ?? archive}`)) {
        try {
          await gitops.pushCurrent();
        } catch (err) {
          this.deps.log(`restore applied but push failed: ${String(err)} (watcher will retry)`);
        }
      }
      return { snapshot: archive, verified, staged: "", changedPaths, applied: true };
    } finally {
      rmSync(staging, { recursive: true, force: true });
      if (tmpArchiveDir) rmSync(tmpArchiveDir, { recursive: true, force: true });
    }
  }
}

function latestLocal(dir: string): string | null {
  const snaps = listSnapshots(dir).sort().reverse();
  return snaps.length ? join(dir, snaps[0]) : null;
}

export function walkForPreview(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

function removeStale(target: string): void {
  if (!existsSync(target)) return;
  if (lstatSync(target).isDirectory()) {
    for (const name of readdirSync(target)) {
      if (name === ".git") continue;
      rmSync(join(target, name), { recursive: true, force: true });
    }
  } else {
    rmSync(target, { force: true });
  }
}

function copyStagingToState(staging: string, stateDir: string): void {
  for (const name of readdirSync(staging)) {
    removeStale(join(stateDir, name));
  }
  cpSync(staging, stateDir, { recursive: true });
}
