import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirp } from "./fsutil.js";
import type { SyncConfig } from "./types.js";

export const DEFAULT_EXCLUDE: string[] = [
  "gh-sync/**",
  "logs/**",
  "**/*.log",
  "**/*.tmp",
  "**/*.pid",
  "**/*.sock",
  "delivery-queue/**",
  "session-delivery-queue/**",
  "cron/runs/**",
  "**/node_modules/**",
  "**/.git/**",
];

export const DEFAULT_CONFIG: SyncConfig = {
  repo: "",
  branch: "",
  instanceName: "",
  include: ["workspace"],
  exclude: [...DEFAULT_EXCLUDE],
  pushDebounceMs: 2000,
  pollIntervalSec: 60,
  backupIntervalH: 6,
  backupRetain: 10,
  gitCryptEnabled: false,
  syncStrategy: "merge",
};

const NAME_RE = /[^a-z0-9-]/g;
const DASH_RE = /-{2,}/g;

export function sanitizeInstanceName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(NAME_RE, "-")
    .replace(DASH_RE, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export class ConfigService {
  constructor(private readonly configPath: string) {}

  load(): SyncConfig | null {
    if (!existsSync(this.configPath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(this.configPath, "utf8")) as SyncConfig;
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch {
      return null;
    }
  }

  save(cfg: SyncConfig): void {
    mkdirp(dirname(this.configPath));
    writeFileSync(this.configPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  }

  validate(raw: unknown): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    if (typeof raw !== "object" || raw === null) return { ok: false, errors: ["config is not an object"] };
    const cfg = raw as Partial<SyncConfig>;
    if (typeof cfg.repo !== "string" || !/^https:\/\/github\.com\/.+/.test(cfg.repo)) errors.push("repo must be an https GitHub URL");
    if (typeof cfg.instanceName !== "string" || !/^[a-z0-9-]+$/.test(cfg.instanceName)) errors.push("instanceName must match [a-z0-9-]");
    if (typeof cfg.branch !== "string" || !cfg.branch.startsWith("instances/")) errors.push("branch must start with instances/");
    if (typeof cfg.pollIntervalSec !== "number" || cfg.pollIntervalSec < 5) errors.push("pollIntervalSec >= 5");
    if (typeof cfg.backupIntervalH !== "number" || cfg.backupIntervalH < 1) errors.push("backupIntervalH >= 1");
    if (cfg.syncStrategy !== undefined && cfg.syncStrategy !== "merge" && cfg.syncStrategy !== "replace-local") errors.push("syncStrategy must be merge or replace-local");
    return { ok: errors.length === 0, errors };
  }
}
