import { mkdirSync } from "node:fs";

export function mkdirp(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function ensureFileMode(filePath: string, mode: number): void {
  try {
    // noop in JS; real chmod happens in credentials.ts
  } catch {
    void filePath;
    void mode;
  }
}
