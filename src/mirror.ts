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

export function copyToMirror(
  entries: MirrorEntry[],
  sourcePaths: string[],
  excluded: (rel: string) => boolean,
): number {
  let count = 0;
  for (const e of entries) {
    for (const sp of sourcePaths) {
      const rel = relative(e.source, sp);
      if (rel.startsWith("..") || excluded(rel)) continue;
      const tgt = join(e.target, rel);
      let st;
      try {
        st = statSync(sp);
      } catch {
        st = null;
      }
      if (!st) {
        try {
          rmSync(tgt, { force: true });
          count += 1;
        } catch {}
        continue;
      }
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

export function copyMirrorToSources(
  entries: MirrorEntry[],
  excluded: (rel: string) => boolean,
  deletedPaths: string[] = [],
): number {
  const deleteSet = new Set(deletedPaths);
  let count = 0;
  for (const e of entries) {
    for (const p of deleteSet) {
      const sp = join(e.source, p);
      try {
        rmSync(sp, { recursive: true, force: true });
      } catch {}
    }
    count += copyDirIfChanged(e.target, e.source, excluded, e.target);
  }
  return count;
}

export function replaceSourcesFromMirror(entries: MirrorEntry[], excluded: (rel: string) => boolean): number {
  let count = 0;
  for (const e of entries) {
    cleanDirForReplace(e.source);
    count += copyDirIfChanged(e.target, e.source, excluded, e.target);
  }
  return count;
}

function cleanDirForReplace(dir: string): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    rmSync(join(dir, name), { recursive: true, force: true });
  }
}
