import { homedir } from "node:os";
import { join } from "node:path";
import type { MirrorEntry } from "./types.js";

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENCLAW_STATE_DIR || join(homedir(), ".openclaw");
}

export function ghSyncDir(stateDir: string): string {
  return join(stateDir, "gh-sync");
}

export function configPath(ghSyncDir: string): string {
  return join(ghSyncDir, "config.json");
}

export function mirrorRoot(ghSyncDir: string): string {
  return join(ghSyncDir, "openclaw");
}

export function backupsDir(ghSyncDir: string): string {
  return join(ghSyncDir, "backups");
}

export function credentialsPath(ghSyncDir: string): string {
  return join(ghSyncDir, ".git-credentials");
}

export function instanceFilePath(ghSyncDir: string): string {
  return join(ghSyncDir, "instance.json");
}

export function lockPath(ghSyncDir: string): string {
  return join(ghSyncDir, ".sync.lock");
}

export function buildMirrorEntries(stateDir: string, ghSyncDir: string, include: string[]): MirrorEntry[] {
  const root = mirrorRoot(ghSyncDir);
  return include.map((rel) => {
    const clean = rel.replace(/^\.\/+/, "");
    return {
      relative: clean,
      source: join(stateDir, clean),
      target: join(root, clean),
    };
  });
}
