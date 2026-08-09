import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export type GitCryptStatus = "ok" | "missing" | "not-inited" | "disabled";

export const SENSITIVE_GLOBS: string[] = [
  "auth/**",
  "credentials/**",
  "channels/**",
  "channel-state/**",
  "whatsapp/**",
  "telegram/**",
  "backups/*.tar.gz",
];

export function gitCryptAvailable(binary = "git-crypt"): boolean {
  const res = spawnSync(binary, ["--version"], { stdio: "ignore" });
  return res.status === 0;
}

export function isRepoInited(syncDir: string): boolean {
  return existsSync(join(syncDir, ".git", "git-crypt", "keys"));
}

export function gitCryptInit(syncDir: string, binary = "git-crypt"): void {
  const res = spawnSync(binary, ["init"], { cwd: syncDir, stdio: "pipe", encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`git-crypt init failed: ${res.stderr ?? res.stdout}`);
  }
}

export function writeGitattributes(syncDir: string, sensitiveGlobs: string[]): void {
  const lines = sensitiveGlobs.map((g) => `${g} filter=git-crypt diff=git-crypt`);
  writeFileSync(join(syncDir, ".gitattributes"), lines.join("\n") + "\n");
}

export function readGitattributes(syncDir: string): string {
  try {
    return readFileSync(join(syncDir, ".gitattributes"), "utf8");
  } catch {
    return "";
  }
}

export function exportKey(syncDir: string, outPath: string, binary = "git-crypt"): void {
  const res = spawnSync(binary, ["export-key", outPath], { cwd: syncDir, stdio: "pipe" });
  if (res.status !== 0) throw new Error("git-crypt export-key failed");
}
