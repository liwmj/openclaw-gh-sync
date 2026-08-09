import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirp } from "./fsutil.js";

export function parseRepoOwnerRepo(repoUrl: string): { owner: string; repo: string } {
  const m = repoUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) throw new Error(`cannot parse GitHub repo URL: ${repoUrl}`);
  return { owner: m[1], repo: m[2] };
}

export function gitCredentialLine(base: string, pat: string): string {
  return `https://x-access-token:${pat}@${base.replace(/^https?:\/\//, "")}`;
}

export function writeCredentials(filePath: string, repoUrl: string, pat: string): void {
  mkdirp(dirname(filePath));
  let base = repoUrl;
  try {
    const { owner, repo } = parseRepoOwnerRepo(repoUrl);
    base = `github.com/${owner}/${repo}.git`;
  } catch {
    // repoUrl may be a bare base URL (e.g. https://github.com); use as-is.
  }
  const line = gitCredentialLine(base, pat);
  writeFileSync(filePath, `${line}\n`, { mode: 0o600 });
  chmodSync(filePath, 0o600);
}

export function readCredentials(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function extractPat(credentialsLine: string): string | null {
  const m = credentialsLine.match(/x-access-token:([^@]+)@/);
  return m ? m[1] : null;
}
