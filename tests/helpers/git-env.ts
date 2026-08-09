import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function makeBareRepo(): { bareDir: string; url: string } {
  const bareDir = mkdtempSync(join(tmpdir(), "bare-"));
  execFileSync("git", ["init", "--bare", bareDir], { stdio: "ignore" });
  return { bareDir, url: bareDir };
}

export function makeWorkDir(): string {
  return mkdtempSync(join(tmpdir(), "work-"));
}

export function cleanup(...dirs: string[]): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
