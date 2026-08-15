import { copyFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ResolveResult } from "./types.js";

export const CONFLICT_RE = /\.(?:conflict|local-conflict|peer-conflict)\.[^/]+$/;
const DETAIL_RE = /^(.*)\.(conflict|local-conflict|peer-conflict)\.([^/]+)$/;

export function parseConflictFile(relPath: string): { base: string; label: string; timestamp: string } | null {
  const m = relPath.match(DETAIL_RE);
  if (!m) return null;
  return { base: m[1], label: m[2], timestamp: m[3] };
}

export function findConflictFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (name === ".git") continue;
        walk(p);
      } else if (CONFLICT_RE.test(name)) {
        found.push(p);
      }
    }
  };
  walk(root);
  return found;
}

export function resolveConflicts(
  root: string,
  strategy: "cleanup" | "accept-copy" | "keep",
  files?: string[],
): ResolveResult {
  if (strategy === "keep") return { strategy, files: [] };
  const targets = files ?? findConflictFiles(root);
  const handled: string[] = [];
  for (const file of targets) {
    const rel = relative(root, file);
    const parsed = parseConflictFile(rel);
    if (!parsed) continue;
    if (strategy === "cleanup") {
      unlinkSync(file);
      handled.push(file);
      continue;
    }
    const basePath = join(root, parsed.base);
    mkdirSync(dirname(basePath), { recursive: true });
    copyFileSync(file, basePath);
    unlinkSync(file);
    handled.push(file);
  }
  return { strategy, files: handled };
}
