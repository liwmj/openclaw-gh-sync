import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { RestoreResult } from "./types.js";

export interface RestoreDeps {
  syncDir: string;
  stateDir: string;
  gitops: { fetch(): Promise<boolean>; ensureBranch(name: string): Promise<void> };
  log: (m: string) => void;
}

export function listSnapshots(backupsDir: string): string[] {
  if (!existsSync(backupsDir)) return [];
  return readdirSync(backupsDir).filter((f) => f.endsWith(".tar.gz"));
}

export function verifyArchive(archivePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const res = spawnSync("openclaw", ["backup", "verify", archivePath], { stdio: "ignore" });
    resolve(res.status === 0);
  });
}

export class RestoreEngine {
  constructor(private readonly deps: RestoreDeps) {}

  async restore(opts: { snapshot?: string; fromInstance?: string; dryRun?: boolean; yes?: boolean }): Promise<RestoreResult> {
    const { stateDir, syncDir, gitops } = this.deps;
    let archive = opts.snapshot ? join(syncDir, "backups", opts.snapshot) : latestLocal(join(syncDir, "backups"));
    if (opts.fromInstance) {
      await gitops.fetch();
      await gitops.ensureBranch(`instances/${opts.fromInstance}`);
      archive = join(syncDir, "backups", latestRemote(join(syncDir, "backups")));
    }
    if (!archive || !existsSync(archive)) throw new Error("no snapshot available");
    const verified = await verifyArchive(archive);
    const staging = join(syncDir, ".restore");
    mkdirSync(staging, { recursive: true });
    const res = spawnSync("tar", ["-xzf", archive, "-C", staging], { stdio: "ignore" });
    if (res.status !== 0) throw new Error("archive extraction failed");
    const changedPaths = walkForPreview(staging);
    if (opts.dryRun) return { snapshot: archive, verified, staged: staging, changedPaths, applied: false };
    if (!opts.yes) throw new Error("dry-run required: pass --yes to apply, or use --dry-run to preview");
    copyStagingToState(staging, stateDir);
    this.deps.log(`restored ${archive}`);
    return { snapshot: archive, verified, staged: staging, changedPaths, applied: true };
  }
}

function latestLocal(dir: string): string | null {
  const snaps = listSnapshots(dir).sort().reverse();
  return snaps.length ? join(dir, snaps[0]) : null;
}

function latestRemote(dir: string): string {
  const snaps = listSnapshots(dir).sort().reverse();
  return snaps[0] ?? "";
}

function walkForPreview(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

function copyStagingToState(staging: string, stateDir: string): void {
  cpSync(staging, stateDir, { recursive: true });
}
