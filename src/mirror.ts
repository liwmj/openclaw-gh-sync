import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { MirrorEntry } from "./types.js";

export function fileEq(a: string, b: string): boolean {
  if (!existsSync(a) || !existsSync(b)) return false;
  const sa = statSync(a);
  const sb = statSync(b);
  if (sa.size !== sb.size) return false;
  if (sa.mtimeMs === sb.mtimeMs) return true;
  return readFileSync(a).equals(readFileSync(b));
}

function copyDirIfChanged(srcDir: string, tgtDir: string, excluded: (rel: string) => boolean, root: string): number {
  if (!existsSync(srcDir)) return 0;
  let count = 0;
  for (const name of readdirSync(srcDir)) {
    if (name === ".git" || name === "node_modules") continue;
    const srcPath = join(srcDir, name);
    const rel = relative(root, srcPath);
    if (excluded(rel)) continue;
    const tgtPath = join(tgtDir, name);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      count += copyDirIfChanged(srcPath, tgtPath, excluded, root);
    } else {
      if (!fileEq(srcPath, tgtPath)) {
        mkdirSync(dirname(tgtPath), { recursive: true });
        copyFileSync(srcPath, tgtPath);
        count += 1;
      }
    }
  }
  return count;
}

export function copyAllToMirror(entries: MirrorEntry[], excluded: (rel: string) => boolean): number {
  let count = 0;
  for (const e of entries) {
    count += copyDirIfChanged(e.source, e.target, excluded, e.source);
  }
  return count;
}

export function copyToMirror(entries: MirrorEntry[], sourcePaths: string[], excluded: (rel: string) => boolean): number {
  let count = 0;
  for (const e of entries) {
    for (const sp of sourcePaths) {
      const rel = relative(e.source, sp);
      if (rel.startsWith("..") || excluded(rel)) continue;
      const st = statSync(sp);
      const tgt = join(e.target, rel);
      if (st.isDirectory()) {
        count += copyDirIfChanged(sp, tgt, excluded, e.source);
      } else if (!fileEq(sp, tgt)) {
        mkdirSync(dirname(tgt), { recursive: true });
        copyFileSync(sp, tgt);
        count += 1;
      }
    }
  }
  return count;
}

export function copyMirrorToSources(entries: MirrorEntry[], excluded: (rel: string) => boolean): number {
  let count = 0;
  for (const e of entries) {
    cleanDir(e.source, excluded, e.target);
    count += copyDirIfChanged(e.target, e.source, excluded, e.target);
  }
  return count;
}

function cleanDir(dir: string, excluded: (rel: string) => boolean, mirrorRoot: string): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === ".git" || name === "node_modules") continue;
    if (excluded(relative(mirrorRoot, p))) continue;
    rmSync(p, { recursive: true, force: true });
  }
}
