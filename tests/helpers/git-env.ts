import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// CI/干净环境没有全局 git 身份时，commit 会报 "empty ident name not allowed"。
// 测试必须自包含：首次调用时确保 user.name/email 存在（有则不动，无则设置测试身份）。
let identityEnsured = false;
function ensureGitIdentity(): void {
  if (identityEnsured) return;
  try {
    execFileSync("git", ["config", "--global", "user.name"], { stdio: "ignore" });
  } catch {
    execFileSync("git", ["config", "--global", "user.name", "gh-sync-tests"]);
    execFileSync("git", ["config", "--global", "user.email", "tests@gh-sync.local"]);
  }
  identityEnsured = true;
}

export function makeBareRepo(): { bareDir: string; url: string } {
  ensureGitIdentity();
  const bareDir = mkdtempSync(join(tmpdir(), "bare-"));
  execFileSync("git", ["init", "--bare", bareDir], { stdio: "ignore" });
  return { bareDir, url: bareDir };
}

export function makeWorkDir(): string {
  ensureGitIdentity();
  return mkdtempSync(join(tmpdir(), "work-"));
}

export function cleanup(...dirs: string[]): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
