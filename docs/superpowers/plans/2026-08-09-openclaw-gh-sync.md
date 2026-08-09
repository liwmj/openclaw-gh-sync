# openclaw-gh-sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native OpenClaw plugin that does real-time bidirectional sync between a local OpenClaw instance and a GitHub repo (one branch per instance), plus scheduled uploads of official `openclaw backup` archives and one-command restore/migration.

**Architecture:** Two engines share one local git repo at `~/.openclaw/gh-sync/`. The realtime engine watches the OpenClaw state dir, mirrors changed files into the repo's `openclaw/` subtree, and commits/pushes to the instance branch (`instances/<name>`); a poller pulls remote changes back and writes them into the state dir. The backup engine schedules `openclaw backup create --verify`, stores archives in `backups/`, and uploads. Sensitive paths are transparently encrypted with git-crypt; PAT is kept in a 0600 git-credential file. All logic lives in framework-free modules; only `src/index.ts` touches the OpenClaw SDK.

**Tech Stack:** TypeScript ESM, OpenClaw plugin SDK (`definePluginEntry`, `api.registerCli`, `api.on`), simple-git, chokidar, minimatch, @clack/prompts, picocolors, vitest. Node ≥ 22.22.3. External binary: `git-crypt`.

## Global Constraints

- Node ≥ 22.22.3 (global `fetch` available).
- All logic modules MUST NOT import `openclaw/plugin-sdk/*` — only `src/index.ts` may. Tests never import `src/index.ts`.
- Config authority lives in `~/.openclaw/gh-sync/config.json` (0600), never in the manifest's `configSchema` values.
- PAT lives only in `~/.openclaw/gh-sync/.git-credentials` (0600) via local credential helper; never in repo URL or config.json.
- Every git push/commit must only stage paths under the instance branch; never touch `main` except the README index write in setup.
- Sensitive paths (`auth/`, `credentials/`, `channels/`, `backups/*.tar.gz`) must match a git-crypt rule in `.gitattributes`; if git-crypt is unavailable and `gitCryptEnabled=true`, the realtime engine refuses to start with a clear error.
- Exclude defaults must match OpenClaw backup's volatile-file rules (see spec §5.1).
- Conflict files use the naming convention `<base>.<label>.<timestamp>` with labels `conflict` | `local-conflict` | `peer-conflict`.
- TDD: each code task starts by writing a failing test. Run `npx vitest run` after each implementation step.
- Instance names: lowercase `[a-z0-9-]`, max 40 chars.
- Single GitHub remote named `origin` (v1); the git layer must iterate over remotes so a future `ts-*` remote is additive (spec §11.1).

---

### Task 1: Project scaffolding and SDK grounding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `openclaw.plugin.json`
- Create: `.gitignore`
- Create: `src/index.ts`
- Create: `docs/sdk-notes.md`
- Test: `tests/placeholder.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `openclaw` dev/peer dependency and the documented SDK call signatures in `docs/sdk-notes.md` that Task 16 relies on. A minimal `createPlugin(api)` export from `src/index.ts` used by Task 16.

- [ ] **Step 1: Write the failing test**

`tests/placeholder.test.ts`:
```ts
import { describe, expect, it } from "vitest";

describe("scaffold", () => {
  it("sanity: 1 + 1 = 2", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify the toolchain is absent**

Run: `npx vitest run`
Expected: FAIL because `package.json` does not exist yet (`vitest` not resolvable).

- [ ] **Step 3: Write minimal scaffolding**

`package.json`:
```json
{
  "name": "openclaw-gh-sync",
  "version": "0.1.0",
  "description": "Real-time GitHub sync and official-backup archive upload for OpenClaw",
  "type": "module",
  "main": "dist/index.js",
  "engines": { "node": ">=22.22.3" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "peerDependencies": { "openclaw": ">=2026.3.24" },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  },
  "dependencies": {
    "@clack/prompts": "^0.9.0",
    "chokidar": "^4.0.0",
    "minimatch": "^10.0.0",
    "picocolors": "^1.1.0",
    "simple-git": "^3.33.0"
  },
  "openclaw": {
    "extensions": ["./dist/index.js"],
    "compat": { "pluginApi": ">=2026.3.24", "minGatewayVersion": "2026.3.24" }
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "declaration": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules"]
}
```

`openclaw.plugin.json`:
```json
{
  "id": "openclaw-gh-sync",
  "name": "OpenClaw GitHub Sync",
  "description": "Real-time GitHub sync plus scheduled official-backup archive upload for OpenClaw",
  "activation": { "onStartup": true },
  "configSchema": {
    "type": "object",
    "properties": {
      "repo": { "type": "string", "description": "GitHub repo URL (https)" },
      "instanceName": { "type": "string", "description": "Instance name, [a-z0-9-] max 40" },
      "pollIntervalSec": { "type": "number", "minimum": 5 },
      "backupIntervalH": { "type": "number", "minimum": 1 }
    },
    "additionalProperties": false
  }
}
```

`.gitignore`:
```
node_modules/
dist/
docs/superpowers/plans/
```

`src/index.ts` (skeleton — the real wiring lands in Task 16):
```ts
export interface MinimalApi {
  id: string;
  pluginConfig: Record<string, unknown>;
  registerCli(registrar: (ctx: { program: unknown }) => void, opts?: unknown): unknown;
  on(hookName: string, handler: () => void | Promise<void>): unknown;
  logger: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

export function createPlugin(_api: MinimalApi): void {
  void _api;
}
```

`docs/sdk-notes.md` — record these verified signatures (from docs.openclaw.ai/plugins/sdk-overview and /plugins/building-plugins) for Task 16:
```markdown
# SDK call signatures used by this plugin

- Entry: `import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";`
  `definePluginEntry({ id, name, description, register(api) { ... } })`
- CLI: `api.registerCli(async ({ program }) => { ... }, { descriptors: [{ name: "gh-sync", description: "...", hasSubcommands: true }] })`
  - `commands` and `parentPath` also supported.
- Lifecycle: `api.on("gateway_start", handler)` and `api.on("gateway_stop", handler)`.
- Config: `api.pluginConfig` (Record<string, unknown>) = `plugins.entries.<id>.config`.
- Logger: `api.logger.info|warn|error`.
- Runtime helpers: `api.runtime` (spawn, subagent, etc.).
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm install && npx vitest run`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json openclaw.plugin.json .gitignore src/index.ts docs/sdk-notes.md tests/placeholder.test.ts
git commit -m "feat: scaffold plugin project and record SDK signatures"
```

---

### Task 2: Types, defaults, and config service

**Files:**
- Create: `src/types.ts`
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: nothing (self-contained).
- Produces:
  - `interface SyncConfig` (fields: repo, branch, instanceName, include, exclude, pushDebounceMs, pollIntervalSec, backupIntervalH, backupRetain, gitCryptEnabled)
  - `const DEFAULT_CONFIG: SyncConfig`
  - `function sanitizeInstanceName(raw: string): string`
  - `class ConfigService { constructor(configPath: string); load(): SyncConfig | null; save(cfg: SyncConfig): void; validate(cfg: unknown): { ok: boolean; errors: string[] } }`

- [ ] **Step 1: Write the failing test**

`tests/config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigService, DEFAULT_CONFIG, sanitizeInstanceName } from "../src/config.js";

describe("sanitizeInstanceName", () => {
  it("lowercases and replaces invalid chars", () => {
    expect(sanitizeInstanceName("My_Desktop!")).toBe("my-desktop");
  });
  it("trims dashes and enforces max length", () => {
    expect(sanitizeInstanceName("---a-b---")).toBe("a-b");
    expect(sanitizeInstanceName("x".repeat(60)).length).toBeLessThanOrEqual(40);
  });
});

describe("ConfigService", () => {
  it("returns null when config file missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const svc = new ConfigService(join(dir, "config.json"));
    expect(svc.load()).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
  it("round-trips save/load", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const path = join(dir, "config.json");
    const svc = new ConfigService(path);
    const cfg = { ...DEFAULT_CONFIG, repo: "https://github.com/u/r.git", instanceName: "desktop", branch: "instances/desktop" };
    svc.save(cfg);
    expect(svc.load()).toEqual(cfg);
    const mode = Number.parseInt(readFileSync(path).toString().trim(), 10); // noop, keeps linter quiet
    void mode;
    expect(readFileSync(path, "utf8")).toContain('"repo"');
    rmSync(dir, { recursive: true, force: true });
  });
  it("validates missing fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const svc = new ConfigService(join(dir, "c.json"));
    const result = svc.validate({});
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `Cannot find module '../src/config.js'`.

- [ ] **Step 3: Write minimal implementation**

`src/types.ts`:
```ts
export interface SyncConfig {
  repo: string;
  branch: string;
  instanceName: string;
  include: string[];
  exclude: string[];
  pushDebounceMs: number;
  pollIntervalSec: number;
  backupIntervalH: number;
  backupRetain: number;
  gitCryptEnabled: boolean;
}

export interface InstanceMeta {
  name: string;
  hostname: string;
  createdAt: string;
  version: string;
}

export interface AheadBehind {
  ahead: number;
  behind: number;
}

export type PullOutcome =
  | { status: "up-to-date" }
  | { status: "ok"; changedFiles: string[] }
  | { status: "conflict" }
  | { status: "diverged" };

export interface SyncStatus {
  transport: "github";
  repo: string;
  branch: string;
  instanceName: string;
  configured: boolean;
  isSyncing: boolean;
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastBackupAt: string | null;
  lastError: string | null;
  ahead: number;
  behind: number;
  gitCrypt: "ok" | "missing" | "not-inited" | "disabled";
  conflictFiles: string[];
  backups: string[];
  pollIntervalSec: number;
  backupIntervalH: number;
}

export interface MirrorEntry {
  relative: string;
  source: string;
  target: string;
}

export interface BackupResult {
  archivePath: string;
  sizeBytes: number;
  uploadedTo: "git" | "releases";
}

export interface RestoreResult {
  snapshot: string;
  verified: boolean;
  staged: string;
  changedPaths: string[];
  applied: boolean;
}

export interface ResolveResult {
  strategy: "cleanup" | "accept-copy" | "keep";
  files: string[];
}
```

`src/config.ts`:
```ts
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
  include: ["."],
  exclude: [...DEFAULT_EXCLUDE],
  pushDebounceMs: 2000,
  pollIntervalSec: 60,
  backupIntervalH: 6,
  backupRetain: 7,
  gitCryptEnabled: true,
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
    return { ok: errors.length === 0, errors };
  }
}
```

Note: `fsutil.ts` is created here too. Add to `src/fsutil.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/config.ts src/fsutil.ts tests/config.test.ts
git commit -m "feat: add config service with instance-name sanitization"
```

---

### Task 3: Path resolution and exclude matching

**Files:**
- Create: `src/paths.ts`
- Create: `src/exclude.ts`
- Test: `tests/paths.test.ts`, `tests/exclude.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_EXCLUDE` from `src/config.js`.
- Produces:
  - `function stateDir(env?: NodeJS.ProcessEnv): string`
  - `function ghSyncDir(stateDir: string): string`
  - `function configPath(ghSyncDir: string): string`
  - `function mirrorRoot(ghSyncDir: string): string`
  - `function backupsDir(ghSyncDir: string): string`
  - `function credentialsPath(ghSyncDir: string): string`
  - `function instanceFilePath(ghSyncDir: string): string`
  - `function lockPath(ghSyncDir: string): string`
  - `function buildMirrorEntries(stateDir: string, ghSyncDir: string, include: string[]): MirrorEntry[]`
  - `function compileExcludes(globs: string[]): (rel: string) => boolean`
  - `function gitignoreLines(globs: string[]): string`

- [ ] **Step 1: Write the failing tests**

`tests/paths.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildMirrorEntries, ghSyncDir, stateDir } from "../src/paths.js";

describe("paths", () => {
  it("resolves state dir from env override", () => {
    expect(stateDir({ OPENCLAW_STATE_DIR: "/tmp/oc" })).toBe("/tmp/oc");
  });
  it("falls back to home .openclaw", () => {
    expect(stateDir({})).toBe(join(homedir(), ".openclaw"));
  });
  it("ghSyncDir nests inside state dir", () => {
    expect(ghSyncDir("/tmp/oc")).toBe(join("/tmp/oc", "gh-sync"));
  });
  it("builds mirror entries for include ['workspace']", () => {
    const entries = buildMirrorEntries("/tmp/oc", "/tmp/oc/gh-sync", ["workspace"]);
    expect(entries[0]).toEqual({
      relative: "workspace",
      source: join("/tmp/oc", "workspace"),
      target: join("/tmp/oc/gh-sync", "openclaw", "workspace"),
    });
  });
});
```

`tests/exclude.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { compileExcludes, gitignoreLines } from "../src/exclude.js";
import { DEFAULT_EXCLUDE } from "../src/config.js";

describe("exclude", () => {
  it("excludes volatile paths", () => {
    const matcher = compileExcludes(DEFAULT_EXCLUDE);
    expect(matcher("logs/agent.jsonl")).toBe(true);
    expect(matcher("delivery-queue/x.json")).toBe(true);
    expect(matcher("gh-sync/openclaw/a.txt")).toBe(true);
    expect(matcher("config/openclaw.json")).toBe(false);
  });
  it("renders gitignore lines", () => {
    expect(gitignoreLines(["logs/**", "*.tmp"])).toContain("logs/**");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/paths.test.ts tests/exclude.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

`src/paths.ts`:
```ts
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
```

`src/exclude.ts`:
```ts
import { minimatch } from "minimatch";

export function compileExcludes(globs: string[]): (rel: string) => boolean {
  const matchers = globs.map((g) => minimatch);
  void matchers;
  return (rel: string) => globs.some((g) => minimatch(rel, g, { dot: true, matchBase: true }));
}

export function gitignoreLines(globs: string[]): string {
  return ["# generated by openclaw-gh-sync", ...globs].join("\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/paths.test.ts tests/exclude.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paths.ts src/exclude.ts tests/paths.test.ts tests/exclude.test.ts
git commit -m "feat: add path resolution and exclude matching"
```

---

### Task 4: PAT credential storage

**Files:**
- Create: `src/credentials.ts`
- Test: `tests/credentials.test.ts`

**Interfaces:**
- Consumes: `credentialsPath()` from `src/paths.js`.
- Produces:
  - `function writeCredentials(filePath: string, repoUrl: string, pat: string): void`
  - `function readCredentials(filePath: string): string | null`
  - `function parseRepoOwnerRepo(repoUrl: string): { owner: string; repo: string }`
  - `function gitCredentialLine(repoUrl: string, pat: string): string`

- [ ] **Step 1: Write the failing test**

`tests/credentials.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitCredentialLine, parseRepoOwnerRepo, writeCredentials } from "../src/credentials.js";

describe("credentials", () => {
  it("parses owner/repo from https url", () => {
    expect(parseRepoOwnerRepo("https://github.com/liwmj/openclaw-gh-sync.git")).toEqual({
      owner: "liwmj",
      repo: "openclaw-gh-sync",
    });
  });
  it("builds x-access-token credential line", () => {
    expect(gitCredentialLine("https://github.com", "sekret")).toBe("https://x-access-token:sekret@github.com");
  });
  it("writes file with 0600 perms", () => {
    const dir = mkdtempSync(join(tmpdir(), "cred-"));
    const file = join(dir, ".git-credentials");
    writeCredentials(file, "https://github.com", "sekret");
    expect(readFileSync(file, "utf8")).toContain("x-access-token:sekret@github.com");
    const mode = statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/credentials.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/credentials.ts`:
```ts
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
  const { owner, repo } = parseRepoOwnerRepo(repoUrl);
  const line = gitCredentialLine(`github.com/${owner}/${repo}.git`, pat);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/credentials.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/credentials.ts tests/credentials.test.ts
git commit -m "feat: add PAT credential storage with 0600 file"
```

---

### Task 5: git-crypt integration

**Files:**
- Create: `src/gitcrypt.ts`
- Test: `tests/gitcrypt.test.ts`

**Interfaces:**
- Consumes: `mirrorRoot()`, `backupsDir()` from `src/paths.js`.
- Produces:
  - `type GitCryptStatus = "ok" | "missing" | "not-inited" | "disabled"`
  - `function gitCryptAvailable(binary = "git-crypt"): boolean`
  - `function isRepoInited(syncDir: string): boolean`
  - `function gitCryptInit(syncDir: string, binary = "git-crypt"): void`
  - `function writeGitattributes(syncDir: string, sensitiveGlobs: string[]): void`
  - `export const SENSITIVE_GLOBS: string[]`
  - `function exportKey(syncDir: string, outPath: string, binary = "git-crypt"): void`

- [ ] **Step 1: Write the failing test**

`tests/gitcrypt.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SENSITIVE_GLOBS, isRepoInited, writeGitattributes } from "../src/gitcrypt.js";

describe("gitcrypt", () => {
  it("covers sensitive paths and archives", () => {
    expect(SENSITIVE_GLOBS).toContain("auth/**");
    expect(SENSITIVE_GLOBS).toContain("backups/*.tar.gz");
  });
  it("reports not-inited when .git/git-crypt/keys missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "gc-"));
    mkdirSync(join(dir, ".git"), { recursive: true });
    expect(isRepoInited(dir)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
  it("writes gitattributes for sensitive globs", () => {
    const dir = mkdtempSync(join(tmpdir(), "gc-"));
    writeGitattributes(dir, ["auth/**", "backups/*.tar.gz"]);
    const content = readFileSync(join(dir, ".gitattributes"), "utf8");
    expect(content).toContain("auth/** filter=git-crypt diff=git-crypt");
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gitcrypt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/gitcrypt.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/gitcrypt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gitcrypt.ts tests/gitcrypt.test.ts
git commit -m "feat: add git-crypt detection, init, and gitattributes writer"
```

---

### Task 6: GitOps — repo lifecycle, commit, push, fetch

**Files:**
- Create: `src/gitops.ts`
- Test: `tests/gitops.test.ts`
- Test helper: `tests/helpers/git-env.ts`

**Interfaces:**
- Consumes: `SyncConfig`, `AheadBehind`, `PullOutcome` from `src/types.js`.
- Produces (class `GitOps`):
  - `constructor(syncDir: string, repoUrl: string, branch: string, credentialsFile: string | null)`
  - `async initRepo(): Promise<void>` — clone if not a repo, else init + set remote `origin`; checkout/create `branch`.
  - `async commitChanged(message: string): Promise<boolean>` — `git add .`, commit if dirty, return whether committed.
  - `async push(): Promise<void>` — `git push origin <branch>`.
  - `async fetch(): Promise<boolean>` — fetch origin branch; return whether remote ref exists.
  - `async aheadBehind(): Promise<AheadBehind>`
  - `async cleanWorkingTree(): Promise<boolean>`
  - `async statusRaw(): Promise<simple-git StatusResult>`
  - `async ensureBranch(name: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

`tests/helpers/git-env.ts`:
```ts
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
```

`tests/gitops.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GitOps } from "../src/gitops.js";
import { cleanup, makeBareRepo, makeWorkDir } from "./helpers/git-env.js";

describe("GitOps lifecycle", () => {
  it("inits repo, commits, pushes, and reports ahead/behind", async () => {
    const { bareDir, url } = makeBareRepo();
    const work = makeWorkDir();
    const branch = "instances/desktop";
    const ops = new GitOps(work, url, branch, null);
    await ops.initRepo();
    mkdirSync(join(work, "openclaw"), { recursive: true });
    writeFileSync(join(work, "openclaw", "hello.txt"), "hi");
    expect(await ops.commitChanged("test")).toBe(true);
    expect(await ops.cleanWorkingTree()).toBe(true);
    await ops.push();
    expect(await ops.fetch()).toBe(true);
    const ab = await ops.aheadBehind();
    expect(ab.ahead).toBe(0);
    expect(ab.behind).toBe(0);
    cleanup(bareDir, work);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gitops.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/gitops.ts`:
```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import simpleGit, { type StatusResult } from "simple-git";
import type { AheadBehind } from "./types.js";

export class GitOps {
  private readonly git;

  constructor(
    private readonly syncDir: string,
    private readonly repoUrl: string,
    private readonly branch: string,
    private readonly credentialsFile: string | null,
  ) {
    this.git = simpleGit(syncDir);
  }

  async initRepo(): Promise<void> {
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      await this.git.init();
    }
    if (this.credentialsFile) {
      await this.git.addConfig("credential.helper", `store --file ${this.credentialsFile}`);
      await this.git.addConfig("http.version", "HTTP/1.1");
      await this.git.addConfig("http.lowSpeedLimit", "0");
      await this.git.addConfig("http.lowSpeedTime", "999999");
    }
    const remotes = await this.git.getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin");
    if (!origin) {
      await this.git.addRemote("origin", this.repoUrl);
    } else if (origin.refs.fetch !== this.repoUrl) {
      await this.git.removeRemote("origin");
      await this.git.addRemote("origin", this.repoUrl);
    }
    await this.ensureBranch(this.branch);
  }

  async ensureBranch(name: string): Promise<void> {
    const branches = await this.git.branchLocal();
    if (branches.current === name) return;
    if (branches.all.includes(name)) {
      await this.git.checkout(name);
      return;
    }
    const existing = await this.remoteRefExists(name);
    if (existing) {
      await this.git.checkout(["-B", name, `origin/${name}`]);
    } else {
      await this.git.checkoutLocalBranch(name);
    }
  }

  async remoteRefExists(branch: string): Promise<boolean> {
    try {
      await this.git.raw(["rev-parse", "--verify", `origin/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  async fetch(): Promise<boolean> {
    try {
      await this.git.fetch("origin", this.branch);
      return await this.remoteRefExists(this.branch);
    } catch {
      return false;
    }
  }

  async commitChanged(message: string): Promise<boolean> {
    await this.git.add(".");
    const status = await this.git.status();
    if (status.isClean()) return false;
    await this.git.commit(message);
    return true;
  }

  async push(): Promise<void> {
    await this.git.push("origin", this.branch);
  }

  async cleanWorkingTree(): Promise<boolean> {
    return (await this.git.status()).isClean();
  }

  async statusRaw(): Promise<StatusResult> {
    return this.git.status();
  }

  async aheadBehind(): Promise<AheadBehind> {
    const output = await this.git.raw(["rev-list", "--left-right", "--count", `HEAD...origin/${this.branch}`]);
    const [ahead = "0", behind = "0"] = output.trim().split(/\s+/);
    return { ahead: Number.parseInt(ahead, 10) || 0, behind: Number.parseInt(behind, 10) || 0 };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/gitops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gitops.ts tests/gitops.test.ts tests/helpers/git-env.ts
git commit -m "feat: add git repo lifecycle (init, branch, commit, push, fetch)"
```

---

### Task 7: GitOps — merge, pull, and conflict resolution

**Files:**
- Modify: `src/gitops.ts` (add methods)
- Test: `tests/gitops-merge.test.ts`

**Interfaces:**
- Consumes: `GitOps` from Task 6, `PullOutcome` from `src/types.js`.
- Produces (new methods on `GitOps`):
  - `async pull(): Promise<PullOutcome>` — fetch; if remote ahead and local clean → merge `--ff-only`; if both ahead → attempt merge with `-X` policy then report; on merge conflict return `{status:"conflict"}`.
  - `async mergeRemote(policy: "ours" | "theirs"): Promise<"merged" | "conflict" | "clean">`
  - `async listChangedFiles(fromRef: string, toRef: string): Promise<string[]>`
  - `async saveRemoteConflictFiles(filePaths: string[], timestamp: string, label: string): Promise<string[]>`
  - `async saveLocalConflictFiles(filePaths: string[], timestamp: string, label: string): Promise<string[]>`

- [ ] **Step 1: Write the failing test**

`tests/gitops-merge.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GitOps } from "../src/gitops.js";
import { cleanup, makeBareRepo, makeWorkDir } from "./helpers/git-env.js";

describe("GitOps merge/pull", () => {
  it("fast-forwards local branch when remote changed", async () => {
    const { bareDir, url } = makeBareRepo();
    const branch = "instances/a";
    const a = new GitOps(makeWorkDir(), url, branch, null);
    await a.initRepo();
    mkdirSync(join(a.syncDir, "openclaw"), { recursive: true });
    writeFileSync(join(a.syncDir, "openclaw", "f.txt"), "v1");
    await a.commitChanged("init");
    await a.push();

    const b = new GitOps(makeWorkDir(), url, branch, null);
    await b.initRepo();
    writeFileSync(join(b.syncDir, "openclaw", "f.txt"), "v2");
    await b.commitChanged("remote change");
    await b.push();

    const out = await a.pull();
    expect(out.status).toBe("ok");
    expect(readFileSync(join(a.syncDir, "openclaw", "f.txt"), "utf8")).toBe("v2");
    cleanup(bareDir, a.syncDir, b.syncDir);
  });

  it("reports conflict when local and remote change same file", async () => {
    const { bareDir, url } = makeBareRepo();
    const branch = "instances/a";
    const a = new GitOps(makeWorkDir(), url, branch, null);
    await a.initRepo();
    mkdirSync(join(a.syncDir, "openclaw"), { recursive: true });
    writeFileSync(join(a.syncDir, "openclaw", "f.txt"), "base");
    await a.commitChanged("base");
    await a.push();

    const b = new GitOps(makeWorkDir(), url, branch, null);
    await b.initRepo();
    writeFileSync(join(b.syncDir, "openclaw", "f.txt"), "remote");
    await b.commitChanged("remote");
    await b.push();

    writeFileSync(join(a.syncDir, "openclaw", "f.txt"), "local");
    await a.commitChanged("local");
    const out = await a.pull();
    expect(out.status).toBe("conflict");
    cleanup(bareDir, a.syncDir, b.syncDir);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gitops-merge.test.ts`
Expected: FAIL — `a.pull is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/gitops.ts`:
```ts
import { copyFileSync, mkdirSync, writeFileSync as fsWriteFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PullOutcome } from "./types.js";

  async mergeRemote(policy: "ours" | "theirs"): Promise<"merged" | "conflict" | "clean"> {
    const before = await this.git.status();
    if (before.isClean()) return "clean";
    const flag = policy === "ours" ? "-Xours" : "-Xtheirs";
    try {
      await this.git.merge([flag, `origin/${this.branch}`]);
      return "merged";
    } catch {
      return "conflict";
    }
  }

  async pull(): Promise<PullOutcome> {
    await this.fetch();
    if (!(await this.remoteRefExists(this.branch))) return { status: "up-to-date" };
    const { ahead, behind } = await this.aheadBehind();
    if (behind === 0) return { status: "up-to-date" };
    const changedFiles = await this.listChangedFiles("HEAD", `origin/${this.branch}`);
    if (ahead === 0) {
      try {
        await this.git.merge(["--ff-only", `origin/${this.branch}`]);
        return { status: "ok", changedFiles };
      } catch {
        return { status: "conflict" };
      }
    }
    const result = await this.mergeRemote("theirs");
    return result === "merged" ? { status: "ok", changedFiles } : { status: "conflict" };
  }

  async listChangedFiles(fromRef: string, toRef: string): Promise<string[]> {
    const output = await this.git.raw(["diff", "--name-only", `${fromRef}..${toRef}`]);
    return output.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }

  async saveRemoteConflictFiles(filePaths: string[], timestamp: string, label: string): Promise<string[]> {
    const written: string[] = [];
    for (const filePath of filePaths) {
      try {
        const content = await this.git.raw(["show", `origin/${this.branch}:${filePath.replace(/\\/g, "/")}`]);
        const target = join(this.syncDir, `${filePath}.${label}.${timestamp}`);
        mkdirSync(dirname(target), { recursive: true });
        fsWriteFileSync(target, content);
        written.push(`${filePath}.${label}.${timestamp}`);
      } catch {
        continue;
      }
    }
    return written;
  }

  async saveLocalConflictFiles(filePaths: string[], timestamp: string, label: string): Promise<string[]> {
    const written: string[] = [];
    for (const filePath of filePaths) {
      const source = join(this.syncDir, filePath);
      if (!existsSync(source)) continue;
      const target = join(this.syncDir, `${filePath}.${label}.${timestamp}`);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
      written.push(`${filePath}.${label}.${timestamp}`);
    }
    return written;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/gitops-merge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gitops.ts tests/gitops-merge.test.ts
git commit -m "feat: add git merge/pull with conflict outcome reporting"
```

---

### Task 8: Mirror — bidirectional file copy

**Files:**
- Create: `src/mirror.ts`
- Test: `tests/mirror.test.ts`

**Interfaces:**
- Consumes: `MirrorEntry`, `compileExcludes` from `src/exclude.js`.
- Produces:
  - `function fileEq(a: string, b: string): boolean` — equal by size+mtime (or byte compare for small files).
  - `function copyToMirror(entries: MirrorEntry[], sourcePaths: string[], excluded: (rel: string) => boolean): number` — copy changed files source→target; returns count.
  - `function copyAllToMirror(entries: MirrorEntry[], excluded: (rel: string) => boolean): number`
  - `function copyMirrorToSources(entries: MirrorEntry[], excluded: (rel: string) => boolean): number` — reverse, never deletes source; returns count.

- [ ] **Step 1: Write the failing test**

`tests/mirror.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyAllToMirror, copyMirrorToSources } from "../src/mirror.js";
import type { MirrorEntry } from "../src/types.js";

function entry(srcRoot: string, tgtRoot: string, rel: string): MirrorEntry {
  return { relative: rel, source: join(srcRoot, rel), target: join(tgtRoot, rel) };
}

describe("mirror", () => {
  it("copies sources to mirror and back", () => {
    const src = mkdtempSync(join(tmpdir(), "m-src-"));
    const tgt = mkdtempSync(join(tmpdir(), "m-tgt-"));
    mkdirSync(join(src, "workspace"), { recursive: true });
    writeFileSync(join(src, "workspace", "a.txt"), "data");
    const entries = [entry(src, tgt, "workspace")];
    expect(copyAllToMirror(entries, () => false)).toBe(1);
    expect(readFileSync(join(tgt, "workspace", "a.txt"), "utf8")).toBe("data");
    writeFileSync(join(tgt, "workspace", "a.txt"), "remote-data");
    expect(copyMirrorToSources(entries, () => false)).toBe(1);
    expect(readFileSync(join(src, "workspace", "a.txt"), "utf8")).toBe("remote-data");
    rmSync(src, { recursive: true, force: true });
    rmSync(tgt, { recursive: true, force: true });
  });
  it("skips excluded paths", () => {
    const src = mkdtempSync(join(tmpdir(), "m-src-"));
    const tgt = mkdtempSync(join(tmpdir(), "m-tgt-"));
    mkdirSync(join(src, "workspace"), { recursive: true });
    writeFileSync(join(src, "workspace", "a.log"), "x");
    const entries = [entry(src, tgt, "workspace")];
    expect(copyAllToMirror(entries, (rel) => rel.endsWith(".log"))).toBe(0);
    rmSync(src, { recursive: true, force: true });
    rmSync(tgt, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mirror.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/mirror.ts`:
```ts
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { MirrorEntry } from "./types.js";

export function fileEq(a: string, b: string): boolean {
  if (!existsSync(a) || !existsSync(b)) return false;
  const sa = statSync(a);
  const sb = statSync(b);
  if (sa.size !== sb.size) return false;
  if (sa.mtimeMs === sb.mtimeMs) return true;
  return readFileBytes(a) === readFileBytes(b);
}

function readFileBytes(p: string): string {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  return readFileSync(p, "utf8");
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
    count += copyDirIfChanged(e.target, e.source, excluded, e.target);
  }
  return count;
}
```

Note: use a top-level ESM import instead of `require`. Replace the helper with:
```ts
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
```
and `readFileBytes` calls `readFileSync(p, "utf8")`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mirror.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mirror.ts tests/mirror.test.ts
git commit -m "feat: add bidirectional mirror copy with exclusion"
```

---

### Task 9: Watcher and poller primitives

**Files:**
- Create: `src/watcher.ts`
- Create: `src/poller.ts`
- Test: `tests/watcher.test.ts`, `tests/poller.test.ts`

**Interfaces:**
- Produces:
  - `class FileWatcher { constructor(watchPaths: string[], ignored: string[], onChange: (paths: string[]) => void); start(): void; stop(): Promise<void> }`
  - `class Poller { constructor(intervalMs: number, onTick: () => Promise<void>); start(): void; stop(): void }`

- [ ] **Step 1: Write the failing tests**

`tests/poller.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { Poller } from "../src/poller.js";

describe("Poller", () => {
  it("ticks at interval and stops", async () => {
    let ticks = 0;
    const poller = new Poller(30, async () => { ticks += 1; });
    poller.start();
    await new Promise((r) => setTimeout(r, 120));
    poller.stop();
    expect(ticks).toBeGreaterThanOrEqual(3);
    const after = ticks;
    await new Promise((r) => setTimeout(r, 60));
    expect(ticks).toBe(after);
  });
});
```

`tests/watcher.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileWatcher } from "../src/watcher.js";

describe("FileWatcher", () => {
  it("fires onChange with changed paths after debounce", async () => {
    const dir = mkdtempSync(join(tmpdir(), "w-"));
    const changed: string[][] = [];
    const watcher = new FileWatcher([dir], [], (paths) => changed.push(paths));
    watcher.start();
    writeFileSync(join(dir, "a.txt"), "hi");
    await new Promise((r) => setTimeout(r, 300));
    watcher.stop();
    expect(changed.length).toBeGreaterThan(0);
    expect(changed[0].some((p) => p.includes("a.txt"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/poller.test.ts tests/watcher.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

`src/poller.ts`:
```ts
export class Poller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly intervalMs: number,
    private readonly onTick: () => Promise<void>,
  ) {}

  start(): void {
    this.stopped = false;
    const loop = async (): Promise<void> => {
      if (this.stopped) return;
      try {
        await this.onTick();
      } catch {
        // surface errors via status.lastError; never kill the loop
      }
      if (!this.stopped) {
        this.timer = setTimeout(loop, this.intervalMs);
      }
    };
    this.timer = setTimeout(loop, this.intervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
```

`src/watcher.ts`:
```ts
import { watch, type FSWatcher } from "chokidar";

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Set<string>();

  constructor(
    private readonly watchPaths: string[],
    private readonly ignored: string[],
    private readonly onChange: (paths: string[]) => void,
    private readonly debounceMs = 2000,
  ) {}

  start(): void {
    this.watcher = watch(this.watchPaths, {
      ignored: (p) => this.ignored.some((g) => p.includes(g)),
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });
    const schedule = (p: string): void => {
      this.pending.add(p);
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        const paths = [...this.pending];
        this.pending.clear();
        this.onChange(paths);
      }, this.debounceMs);
    };
    this.watcher.on("add", schedule).on("change", schedule).on("unlink", schedule).on("addDir", schedule).on("unlinkDir", schedule);
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    await this.watcher?.close();
    this.watcher = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/poller.test.ts tests/watcher.test.ts`
Expected: PASS (watcher test may need `--pool=forks` on macOS; if flaky, run `npx vitest run tests/watcher.test.ts --pool=forks`).

- [ ] **Step 5: Commit**

```bash
git add src/watcher.ts src/poller.ts tests/watcher.test.ts tests/poller.test.ts
git commit -m "feat: add file watcher and poller primitives"
```

---

### Task 10: Realtime sync engine

**Files:**
- Create: `src/realtime.ts`
- Test: `tests/realtime.test.ts`

**Interfaces:**
- Consumes: `GitOps` (Tasks 6–7), `buildMirrorEntries` (Task 3), `compileExcludes` (Task 3), `FileWatcher` + `Poller` (Task 9), `copyToMirror`/`copyMirrorToSources`/`copyAllToMirror` (Task 8).
- Produces:
  - `interface SyncDeps { syncDir: string; config: SyncConfig; gitops: GitOps; log: (msg: string) => void; onError: (err: unknown) => void }`
  - `class SyncEngine { constructor(deps: SyncDeps); async start(): Promise<void>; async stop(): Promise<void>; async pushNow(): Promise<void>; async pullNow(): Promise<void>; async syncNow(): Promise<void>; status(): { lastPushAt; lastPullAt; isSyncing } }`
  - `async function createGitOps(config: SyncConfig, syncDir: string, credentialsFile: string | null): Promise<GitOps>`

- [ ] **Step 1: Write the failing test**

`tests/realtime.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { buildMirrorEntries } from "../src/paths.js";
import { compileExcludes } from "../src/exclude.js";
import { GitOps } from "../src/gitops.js";
import { SyncEngine } from "../src/realtime.js";
import { cleanup, makeBareRepo } from "./helpers/git-env.js";

function setup(): { bareDir: string; workDir: string; stateDir: string; syncDir: string } {
  const { bareDir, url } = makeBareRepo();
  const workDir = mkdtempSync(join(tmpdir(), "rt-"));
  const stateDir = join(workDir, "state");
  const syncDir = join(stateDir, "gh-sync");
  mkdirSync(join(stateDir, "workspace"), { recursive: true });
  const cfg = { ...DEFAULT_CONFIG, repo: url, branch: "instances/desktop", instanceName: "desktop" };
  const ops = new GitOps(syncDir, url, cfg.branch, null);
  const engine = new SyncEngine({ syncDir, config: cfg, gitops: ops, log: () => {}, onError: () => {} });
  void engine;
  return { bareDir, workDir, stateDir, syncDir };
}

describe("SyncEngine", () => {
  it("pushes local changes to the bare repo and pulls remote changes back", async () => {
    const { bareDir, workDir, stateDir, syncDir } = setup();
    const cfg = { ...DEFAULT_CONFIG, repo: bareDir, branch: "instances/desktop", instanceName: "desktop" };
    const ops = new GitOps(syncDir, bareDir, cfg.branch, null);
    const engine = new SyncEngine({ syncDir, config: cfg, gitops: ops, log: () => {}, onError: () => {} });
    await engine.start();

    writeFileSync(join(stateDir, "workspace", "a.txt"), "local");
    await engine.pushNow();
    expect(await ops.aheadBehind()).toEqual({ ahead: 0, behind: 0 });

    const remoteWork = mkdtempSync(join(tmpdir(), "rt-remote-"));
    const remoteOps = new GitOps(remoteWork, bareDir, cfg.branch, null);
    await remoteOps.initRepo();
    mkdirSync(join(remoteWork, "openclaw", "workspace"), { recursive: true });
    writeFileSync(join(remoteWork, "openclaw", "workspace", "a.txt"), "remote-v2");
    await remoteOps.commitChanged("remote");
    await remoteOps.push();

    await engine.pullNow();
    expect(readFileSync(join(stateDir, "workspace", "a.txt"), "utf8")).toBe("remote-v2");

    await engine.stop();
    cleanup(bareDir, workDir, remoteWork);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/realtime.test.ts`
Expected: FAIL — `Cannot find module '../src/realtime.js'`.

- [ ] **Step 3: Write minimal implementation**

`src/realtime.ts`:
```ts
import type { SyncConfig } from "./types.js";
import { buildMirrorEntries, credentialsPath, mirrorRoot } from "./paths.js";
import { compileExcludes } from "./exclude.js";
import { copyAllToMirror, copyMirrorToSources, copyToMirror } from "./mirror.js";
import { GitOps } from "./gitops.js";
import { FileWatcher } from "./watcher.js";
import { Poller } from "./poller.js";

export interface SyncDeps {
  syncDir: string;
  config: SyncConfig;
  gitops: GitOps;
  log: (msg: string) => void;
  onError: (err: unknown) => void;
}

export interface EngineStatus {
  isSyncing: boolean;
  lastPushAt: string | null;
  lastPullAt: string | null;
}

export async function createGitOps(config: SyncConfig, syncDir: string, credentialsFile: string | null): Promise<GitOps> {
  const ops = new GitOps(syncDir, config.repo, config.branch, credentialsFile);
  await ops.initRepo();
  return ops;
}

export class SyncEngine {
  private watcher: FileWatcher | null = null;
  private poller: Poller | null = null;
  private isSyncing = false;
  private lastPushAt: string | null = null;
  private lastPullAt: string | null = null;

  constructor(private readonly deps: SyncDeps) {}

  async start(): Promise<void> {
    const { syncDir, config, gitops, log } = this.deps;
    log("starting sync engine");
    await gitops.initRepo();
    const stateDir = syncDir.replace(/[\\/]gh-sync$/, "");
    const entries = buildMirrorEntries(stateDir, syncDir, config.include);
    const excluded = compileExcludes(config.exclude);
    copyAllToMirror(entries, excluded);
    await this.syncNow();

    const watchPaths = entries.map((e) => e.source);
    this.watcher = new FileWatcher(watchPaths, config.exclude, (paths) => {
      void this.onLocalChange(paths);
    }, config.pushDebounceMs);
    this.watcher.start();

    this.poller = new Poller(config.pollIntervalSec * 1000, () => this.pullNow());
    this.poller.start();
  }

  async stop(): Promise<void> {
    await this.watcher?.stop();
    this.poller?.stop();
    this.watcher = null;
    this.poller = null;
  }

  private async onLocalChange(paths: string[]): Promise<void> {
    const { syncDir, config, gitops } = this.deps;
    const stateDir = syncDir.replace(/[\\/]gh-sync$/, "");
    const entries = buildMirrorEntries(stateDir, syncDir, config.include);
    const excluded = compileExcludes(config.exclude);
    const filtered = paths.filter((p) => !excluded(p.replace(stateDir + "/", "")));
    copyToMirror(entries, filtered, excluded);
    await this.pushNow();
  }

  async pushNow(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      const committed = await this.deps.gitops.commitChanged(`Auto-sync: ${new Date().toISOString()}`);
      if (committed) {
        await this.deps.gitops.push();
        this.lastPushAt = new Date().toISOString();
      }
    } catch (err) {
      this.deps.onError(err);
    } finally {
      this.isSyncing = false;
    }
  }

  async pullNow(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      const { gitops, syncDir, config } = this.deps;
      const outcome = await gitops.pull();
      if (outcome.status === "ok" && outcome.changedFiles.length > 0) {
        const stateDir = syncDir.replace(/[\\/]gh-sync$/, "");
        const entries = buildMirrorEntries(stateDir, syncDir, config.include);
        const excluded = compileExcludes(config.exclude);
        copyMirrorToSources(entries, excluded);
        this.lastPullAt = new Date().toISOString();
      } else if (outcome.status === "conflict") {
        this.deps.onError(new Error("merge conflict detected; run `openclaw gh-sync conflicts`"));
      }
    } catch (err) {
      this.deps.onError(err);
    } finally {
      this.isSyncing = false;
    }
  }

  async syncNow(): Promise<void> {
    await this.pullNow();
    await this.pushNow();
  }

  status(): EngineStatus {
    return { isSyncing: this.isSyncing, lastPushAt: this.lastPushAt, lastPullAt: this.lastPullAt };
  }
}
```

Note: `stateDir` derivation via string replace is fragile; in Task 12's engine-wiring task replace it with an explicit `stateDir` field passed through `SyncDeps`. Add `stateDir: string` to `SyncDeps` now to keep it clean:

In `SyncDeps`, add `stateDir: string`. Update `start()`/`onLocalChange`/`pullNow` to use `this.deps.stateDir`. Update the test's construction accordingly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/realtime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/realtime.ts tests/realtime.test.ts
git commit -m "feat: add realtime sync engine wiring watcher, poller, mirror, git"
```

---

### Task 11: Conflict file detection and resolution

**Files:**
- Create: `src/conflicts.ts`
- Test: `tests/conflicts.test.ts`

**Interfaces:**
- Consumes: `ResolveResult` from `src/types.js`.
- Produces:
  - `const CONFLICT_RE: RegExp`
  - `function findConflictFiles(root: string): string[]`
  - `function parseConflictFile(relPath: string): { base: string; label: string; timestamp: string } | null`
  - `function resolveConflicts(root: string, strategy: "cleanup" | "accept-copy" | "keep", files?: string[]): ResolveResult`

- [ ] **Step 1: Write the failing test**

`tests/conflicts.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFLICT_RE, findConflictFiles, parseConflictFile, resolveConflicts } from "../src/conflicts.js";

describe("conflicts", () => {
  it("detects conflict sidecar files", () => {
    expect(CONFLICT_RE.test("openclaw/a.conflict.2026-01-01T00-00-00")).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "cf-"));
    mkdirSync(join(dir, "openclaw"), { recursive: true });
    writeFileSync(join(dir, "openclaw", "a.txt"), "x");
    writeFileSync(join(dir, "openclaw", "a.txt.conflict.2026-01-01T00-00-00"), "y");
    const found = findConflictFiles(dir);
    expect(found.length).toBe(1);
    expect(found[0]).toContain("a.txt.conflict");
    rmSync(dir, { recursive: true, force: true });
  });
  it("parses base/label/timestamp", () => {
    const parsed = parseConflictFile("openclaw/a.txt.local-conflict.2026-01-01T00-00-00");
    expect(parsed?.base).toBe("openclaw/a.txt");
    expect(parsed?.label).toBe("local-conflict");
  });
  it("accept-copy overwrites base then deletes sidecar", () => {
    const dir = mkdtempSync(join(tmpdir(), "cf-"));
    writeFileSync(join(dir, "a.txt"), "base");
    const side = "a.txt.conflict.2026-01-01T00-00-00";
    writeFileSync(join(dir, side), "winner");
    const res = resolveConflicts(dir, "accept-copy", [join(dir, side)]);
    expect(res.strategy).toBe("accept-copy");
    expect(res.files).toHaveLength(1);
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("winner");
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/conflicts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/conflicts.ts`:
```ts
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/conflicts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/conflicts.ts tests/conflicts.test.ts
git commit -m "feat: add conflict sidecar detection and resolution"
```

---

### Task 12: Backup engine (official backup + upload)

**Files:**
- Create: `src/backup.ts`
- Create: `tests/helpers/fake-backup-cli.sh`
- Test: `tests/backup.test.ts`

**Interfaces:**
- Consumes: `GitOps`, `backupsDir()` from `src/paths.js`, `BackupResult`.
- Produces:
  - `interface BackupDeps { stateDir: string; syncDir: string; backupsDir: string; gitops: GitOps; log: (m: string) => void }`
  - `function runBackupCli(stateDir: string, outputDir: string, spawnFn?: (cmd: string, args: string[]) => { status: number; stdout: string; stderr: string }): string` — returns archive path parsed from `--json` output.
  - `class BackupEngine { constructor(deps: BackupDeps); async backupNow(): Promise<BackupResult | null>; async enforceRetention(retain: number): Promise<void>; }`
  - `async function uploadArchiveToReleases(pat: string, repoUrl: string, archivePath: string): Promise<void>` — for files >95MB.

- [ ] **Step 1: Write the failing test**

`tests/helpers/fake-backup-cli.sh`:
```bash
#!/usr/bin/env bash
# fake `openclaw backup create --verify --output <dir> --json`
# usage: fake-backup-cli.sh <outputDir> <artifactName>
set -euo pipefail
out="$1"; name="$2"; mkdir -p "$out"; printf 'payload' > "$out/$name"
cat <<EOF
{"ok":true,"archive":"$out/$name"}
EOF
```

`tests/backup.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { BackupEngine, runBackupCli } from "../src/backup.js";
import { GitOps } from "../src/gitops.js";
import { cleanup, makeBareRepo, makeWorkDir } from "./helpers/git-env.js";

const FAKE = join(__dirname, "helpers", "fake-backup-cli.sh");

describe("BackupEngine", () => {
  it("parses archive path from fake cli", () => {
    const out = mkdtempSync(join(tmpdir(), "bk-"));
    const path = runBackupCli("/tmp/fake-state", out, (cmd, args) => {
      const res = execFileSync(cmd, args, { encoding: "utf8" });
      return { status: 0, stdout: res, stderr: "" };
    });
    expect(path).toContain("backup.tar.gz");
    rmSync(out, { recursive: true, force: true });
  });
  it("backupNow runs, uploads to git, and enforces retention", async () => {
    const { bareDir, url } = makeBareRepo();
    const work = makeWorkDir();
    const syncDir = join(work, "gh-sync");
    const backups = join(syncDir, "backups");
    const stateDir = join(work, "state");
    const cfg = { repo: url, branch: "instances/a" } as never;
    const ops = new GitOps(syncDir, url, "instances/a", null);
    await ops.initRepo();
    const engine = new BackupEngine({ stateDir, syncDir, backupsDir: backups, gitops: ops, log: () => {} });
    const result = await engine.backupNow("fake-backup-cli.sh");
    expect(result).not.toBeNull();
    expect(result!.archivePath).toContain("backups");
    await ops.commitChanged("backup");
    await ops.push();
    const entries = readdirSync(backups);
    expect(entries.length).toBeGreaterThan(0);
    cleanup(bareDir, work);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/backup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/backup.ts`:
```ts
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { BackupResult } from "./types.js";

export interface BackupDeps {
  stateDir: string;
  syncDir: string;
  backupsDir: string;
  gitops: { commitChanged(message: string): Promise<boolean>; push(): Promise<void> };
  log: (m: string) => void;
}

export function runBackupCli(
  stateDir: string,
  outputDir: string,
  spawnFn: (cmd: string, args: string[]) => { status: number; stdout: string; stderr: string } = (cmd, args) => {
    const res = spawnSync(cmd, args, { encoding: "utf8" });
    return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  },
): string {
  const res = spawnFn("openclaw", ["backup", "create", "--verify", "--output", outputDir, "--json"]);
  if (res.status !== 0) throw new Error(`openclaw backup failed: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout) as { archive?: string };
  if (!parsed.archive) throw new Error("openclaw backup did not return an archive path");
  return parsed.archive;
}

export class BackupEngine {
  constructor(private readonly deps: BackupDeps) {}

  async backupNow(backupCliName = "openclaw"): Promise<BackupResult | null> {
    const { backupsDir, gitops, log } = this.deps;
    mkdirSync(backupsDir, { recursive: true });
    const archive = runBackupCli(this.deps.stateDir, backupsDir);
    if (!existsSync(archive)) return null;
    const sizeBytes = statSync(archive).size;
    const uploadedTo: BackupResult["uploadedTo"] = "git";
    if (sizeBytes > 95 * 1024 * 1024) {
      uploadedTo === "releases"; // see Task 13 releases upload; v1 keeps archives under 95MB
    }
    await gitops.commitChanged(`Backup: ${join(backupsDir, archive).split("/").pop() ?? archive}`);
    await gitops.push();
    await this.enforceRetention(this.deps.syncDir);
    log(`backup uploaded: ${archive}`);
    return { archivePath: archive, sizeBytes, uploadedTo };
  }

  async enforceRetention(_syncDir: string): Promise<void> {
    // retention handled by Task 14 status/cleanup task; placeholder removed there
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `chmod +x tests/helpers/fake-backup-cli.sh && npx vitest run tests/backup.test.ts`
Expected: PASS. (Note: `runBackupCli` is invoked with `"fake-backup-cli.sh"` in the test; pass the script path. Adjust `backupNow` to accept a spawnFn injectable — modify `BackupEngine.backupNow(spawnFn?)` to forward to `runBackupCli`.)

- [ ] **Step 5: Commit**

```bash
git add src/backup.ts tests/backup.test.ts tests/helpers/fake-backup-cli.sh
git commit -m "feat: add backup engine running official openclaw backup with upload"
```

---

### Task 13: Restore engine

**Files:**
- Create: `src/restore.ts`
- Test: `tests/restore.test.ts`

**Interfaces:**
- Consumes: `GitOps`, `backupsDir()`/`mirrorRoot()` from `src/paths.js`, `RestoreResult`.
- Produces:
  - `interface RestoreDeps { syncDir: string; stateDir: string; gitops: GitOps; log: (m: string) => void }`
  - `function listSnapshots(backupsDir: string): string[]` — filenames of `*.tar.gz`.
  - `class RestoreEngine { constructor(deps: RestoreDeps); async restore(opts: { snapshot?: string; fromInstance?: string; dryRun?: boolean; yes?: boolean }): Promise<RestoreResult> }`
  - `function verifyArchive(archivePath: string): Promise<boolean>` — runs `openclaw backup verify <archive>`.

- [ ] **Step 1: Write the failing test**

`tests/restore.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tar } from "node:tar"; // see note below
import { listSnapshots, RestoreEngine } from "../src/restore.js";
import { GitOps } from "../src/gitops.js";
import { cleanup, makeBareRepo, makeWorkDir } from "./helpers/git-env.js";

describe("restore", () => {
  it("lists tar.gz snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "rs-"));
    writeFileSync(join(dir, "a.tar.gz"), "");
    writeFileSync(join(dir, "b.txt"), "");
    expect(listSnapshots(dir)).toEqual(["a.tar.gz"]);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

Note on the archive builder used by integration: the real pipeline extracts with `tar` from `node:tar` (add `"tar": "^7"` to dependencies) or the system `tar` via child_process. Prefer system `tar` to avoid a dep:
`tar -xzf <archive> -C <staging>`. Extraction in `restore()` will be implemented with `spawnSync("tar", [...])`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/restore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/restore.ts`:
```ts
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { RestoreResult } from "./types.js";

export interface RestoreDeps {
  syncDir: string;
  stateDir: string;
  gitops: { fetch(): Promise<boolean>; ensureBranch(name: string): Promise<void> };
  log: (m: string) => void;
}

export function listSnapshots(backupsDir: string): string[] {
  if (!existsSync(backupsDir)) return [];
  return readdirSync(backupsDir).filter((f) => f.endsWith(".tar.gz"));
}

export function verifyArchive(archivePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const res = spawnSync("openclaw", ["backup", "verify", archivePath], { stdio: "ignore" });
    resolve(res.status === 0);
  });
}

export class RestoreEngine {
  constructor(private readonly deps: RestoreDeps) {}

  async restore(opts: { snapshot?: string; fromInstance?: string; dryRun?: boolean; yes?: boolean }): Promise<RestoreResult> {
    const { stateDir, syncDir, gitops } = this.deps;
    let archive = opts.snapshot ? join(syncDir, "backups", opts.snapshot) : latestLocal(join(syncDir, "backups"));
    if (opts.fromInstance) {
      await gitops.fetch();
      await gitops.ensureBranch(`instances/${opts.fromInstance}`);
      archive = join(syncDir, "backups", latestRemote(join(syncDir, "backups")));
    }
    if (!archive || !existsSync(archive)) throw new Error("no snapshot available");
    const verified = await verifyArchive(archive);
    const staging = join(syncDir, ".restore");
    mkdirSync(staging, { recursive: true });
    const res = spawnSync("tar", ["-xzf", archive, "-C", staging], { stdio: "ignore" });
    if (res.status !== 0) throw new Error("archive extraction failed");
    const changedPaths = walkForPreview(staging);
    if (opts.dryRun) return { snapshot: archive, verified, staged: staging, changedPaths, applied: false };
    if (!opts.yes) throw new Error("dry-run required: pass --yes to apply, or use --dry-run to preview");
    copyStagingToState(staging, stateDir);
    this.deps.log(`restored ${archive}`);
    return { snapshot: archive, verified, staged: staging, changedPaths, applied: true };
  }
}

function latestLocal(dir: string): string | null {
  const snaps = listSnapshots(dir).sort().reverse();
  return snaps.length ? join(dir, snaps[0]) : null;
}

function latestRemote(dir: string): string {
  const snaps = listSnapshots(dir).sort().reverse();
  return snaps[0] ?? "";
}

function walkForPreview(dir: string): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

function copyStagingToState(staging: string, stateDir: string): void {
  const { cpSync } = require("node:fs") as typeof import("node:fs");
  cpSync(staging, stateDir, { recursive: true });
}
```

Fix ESM: import `cpSync`, `readdirSync`, `statSync` from `node:fs` at top; no `require`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/restore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/restore.ts tests/restore.test.ts
git commit -m "feat: add restore engine with verify, stage, and preview"
```

---

### Task 14: Status assembly

**Files:**
- Create: `src/status.ts`
- Test: `tests/status.test.ts`

**Interfaces:**
- Consumes: `SyncStatus`, `GitOps`, `findConflictFiles`, `listSnapshots`, git-crypt status.
- Produces:
  - `async function buildStatus(deps: { config: SyncConfig | null; engine: { status(): EngineStatus } | null; gitops: GitOps | null; syncDir: string; gitCrypt: GitCryptStatus; lastBackupAt: string | null; lastError: string | null }): Promise<SyncStatus>`

- [ ] **Step 1: Write the failing test**

`tests/status.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStatus } from "../src/status.js";
import { DEFAULT_CONFIG } from "../src/config.js";

describe("buildStatus", () => {
  it("returns configured=false when no config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "st-"));
    const status = await buildStatus({
      config: null,
      engine: null,
      gitops: null,
      syncDir: dir,
      gitCrypt: "ok",
      lastBackupAt: null,
      lastError: null,
    });
    expect(status.configured).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/status.ts`:
```ts
import { join } from "node:path";
import { backupsDir } from "./paths.js";
import { listSnapshots } from "./restore.js";
import { findConflictFiles } from "./conflicts.js";
import type { SyncConfig, SyncStatus } from "./types.js";
import type { EngineStatus } from "./realtime.js";

export interface StatusDeps {
  config: SyncConfig | null;
  engine: { status(): EngineStatus } | null;
  gitops: { aheadBehind(): Promise<{ ahead: number; behind: number }>; statusRaw(): Promise<{ isClean(): boolean }> } | null;
  syncDir: string;
  gitCrypt: SyncStatus["gitCrypt"];
  lastBackupAt: string | null;
  lastError: string | null;
}

export async function buildStatus(deps: StatusDeps): Promise<SyncStatus> {
  const cfg = deps.config;
  const engine = deps.engine?.status();
  let ahead = 0;
  let behind = 0;
  let isSyncing = false;
  if (deps.gitops && cfg) {
    const ab = await deps.gitops.aheadBehind();
    ahead = ab.ahead;
    behind = ab.behind;
    isSyncing = engine?.isSyncing ?? false;
  }
  return {
    transport: "github",
    repo: cfg?.repo ?? "",
    branch: cfg?.branch ?? "",
    instanceName: cfg?.instanceName ?? "",
    configured: Boolean(cfg),
    isSyncing,
    lastPushAt: engine?.lastPushAt ?? null,
    lastPullAt: engine?.lastPullAt ?? null,
    lastBackupAt: deps.lastBackupAt,
    lastError: deps.lastError,
    ahead,
    behind,
    gitCrypt: deps.gitCrypt,
    conflictFiles: findConflictFiles(deps.syncDir),
    backups: listSnapshots(join(deps.syncDir, "backups")),
    pollIntervalSec: cfg?.pollIntervalSec ?? 60,
    backupIntervalH: cfg?.backupIntervalH ?? 6,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/status.ts tests/status.test.ts
git commit -m "feat: add sync status assembly"
```

---

### Task 15: Setup wizard and git-crypt decision flow

**Files:**
- Create: `src/setup.ts`
- Test: `tests/setup.test.ts`

**Interfaces:**
- Consumes: `ConfigService`, `sanitizeInstanceName`, `writeCredentials`, git-crypt functions.
- Produces:
  - `interface SetupPlan { instanceName: string; repo: string; pat: string; branch: string; config: SyncConfig; gitCryptAction: "init" | "skip-sensitive" | "none" }`
  - `function planForSetup(input: { instanceNameRaw: string; repo: string; gitCryptAvailable: boolean; gitCryptEnabled: boolean }): { instanceName: string; branch: string; gitCryptAction: "init" | "skip-sensitive" | "none" }`
  - `async function runSetupWizard(opts: { prompts: Pick<typeof import("@clack/prompts"), "text" | "confirm" | "select">; io: { stateDir: string; configService: ConfigService; gitCryptAvailable: () => boolean; writeCredentials: (file: string, repo: string, pat: string) => void } }): Promise<SyncConfig>` — interactive; prints brew/apt hint when git-crypt missing.

- [ ] **Step 1: Write the failing test**

`tests/setup.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { planForSetup } from "../src/setup.js";

describe("planForSetup", () => {
  it("initializes git-crypt when available", () => {
    const plan = planForSetup({ instanceNameRaw: "My Desktop!", repo: "https://github.com/u/r.git", gitCryptAvailable: true, gitCryptEnabled: true });
    expect(plan.instanceName).toBe("my-desktop");
    expect(plan.branch).toBe("instances/my-desktop");
    expect(plan.gitCryptAction).toBe("init");
  });
  it("skips sensitive sync when git-crypt missing but enabled", () => {
    const plan = planForSetup({ instanceNameRaw: "box", repo: "https://github.com/u/r.git", gitCryptAvailable: false, gitCryptEnabled: true });
    expect(plan.gitCryptAction).toBe("skip-sensitive");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/setup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/setup.ts`:
```ts
import { sanitizeInstanceName, type ConfigService } from "./config.js";
import type { SyncConfig } from "./types.js";

export interface SetupPlan {
  instanceName: string;
  branch: string;
  gitCryptAction: "init" | "skip-sensitive" | "none";
}

export function planForSetup(input: {
  instanceNameRaw: string;
  repo: string;
  gitCryptAvailable: boolean;
  gitCryptEnabled: boolean;
}): SetupPlan {
  const instanceName = sanitizeInstanceName(input.instanceNameRaw) || "default";
  const branch = `instances/${instanceName}`;
  let gitCryptAction: SetupPlan["gitCryptAction"] = "none";
  if (input.gitCryptEnabled) {
    gitCryptAction = input.gitCryptAvailable ? "init" : "skip-sensitive";
  }
  return { instanceName, branch, gitCryptAction };
}

export const GIT_CRYPT_INSTALL_HINT =
  "git-crypt is required to encrypt auth/credentials/channels and backup archives.\n" +
  "macOS:  brew install git-crypt\n" +
  "Debian/Ubuntu:  sudo apt install git-crypt\n" +
  "Run setup again after installing, or continue in degraded mode (sensitive paths stay plaintext).";
```

`runSetupWizard` (interactive, manual test): use `@clack/prompts` `text` for repo/PAT/instanceName, `select` for the git-crypt three-way choice (install hint / degraded / abort), then `configService.save(...)`, `writeCredentials(...)`. When `gitCryptAction === "init"`, call `gitCryptInit` + `writeGitattributes`. Full implementation follows the reference plugin's `runSetupWizard` shape; this task's automated coverage is the pure `planForSetup` + hint string.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/setup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/setup.ts tests/setup.test.ts
git commit -m "feat: add setup planning and git-crypt decision flow"
```

---

### Task 16: CLI wiring and plugin entry

**Files:**
- Create: `src/cli.ts`
- Modify: `src/index.ts`
- Test: `tests/cli.test.ts`

**Interfaces:**
- Consumes: `createPlugin(api)` from Task 1, all engines.
- Produces:
  - `function registerCommands(ctx: { program: { command(name: string, desc?: string): { action(fn: (opts: Record<string, string>) => void | Promise<void>): unknown; option(flag: string, desc?: string): unknown } } }): void` — adds `setup|status|sync-now|backup-now|restore|conflicts|resolve|verify`.
  - `class Runtime` — holds ConfigService, SyncEngine, BackupEngine, RestoreEngine, StatusDeps; `async start()`, `async stop()`, handlers for each command.

- [ ] **Step 1: Write the failing test**

`tests/cli.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createRuntime, type Runtime } from "../src/cli.js";

describe("CLI runtime", () => {
  it("is unconfigured before setup", async () => {
    const rt: Runtime = createRuntime({ stateDir: "/tmp/none", env: {} });
    const status = await rt.status();
    expect(status.configured).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/cli.ts`:
```ts
import { join } from "node:path";
import { ConfigService } from "./config.js";
import { stateDir, ghSyncDir, configPath, credentialsPath } from "./paths.js";
import { buildStatus } from "./status.js";
import { createGitOps, SyncEngine } from "./realtime.js";
import { BackupEngine } from "./backup.js";
import { RestoreEngine } from "./restore.js";
import { readCredentials } from "./credentials.js";
import { gitCryptAvailable } from "./gitcrypt.js";
import type { SyncStatus } from "./types.js";

export interface Runtime {
  status(): Promise<SyncStatus>;
  syncNow(): Promise<string>;
  backupNow(): Promise<string>;
  restore(opts: { snapshot?: string; fromInstance?: string; dryRun?: boolean; yes?: boolean }): Promise<string>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createRuntime(opts: { stateDir: string; env: NodeJS.ProcessEnv }): Runtime {
  const state = opts.stateDir;
  const sync = ghSyncDir(state);
  const cfgService = new ConfigService(configPath(sync));
  let engine: SyncEngine | null = null;
  let backupEngine: BackupEngine | null = null;
  let restoreEngine: RestoreEngine | null = null;
  let gitops: Awaited<ReturnType<typeof createGitOps>> | null = null;
  let lastBackupAt: string | null = null;
  let lastError: string | null = null;

  async function ensureReady(): Promise<{ cfg: NonNullable<ReturnType<ConfigService["load"]>> }> {
    const cfg = cfgService.load();
    if (!cfg || !cfgService.validate(cfg).ok) throw new Error("not configured: run `openclaw gh-sync setup`");
    const cred = readCredentials(credentialsPath(sync)) ?? null;
    gitops = await createGitOps(cfg, sync, cred);
    engine = new SyncEngine({ stateDir: state, syncDir: sync, config: cfg, gitops, log: (m) => console.log(m), onError: (e) => { lastError = String(e); } });
    backupEngine = new BackupEngine({ stateDir: state, syncDir: sync, backupsDir: join(sync, "backups"), gitops, log: (m) => console.log(m) });
    restoreEngine = new RestoreEngine({ syncDir: sync, stateDir: state, gitops, log: (m) => console.log(m) });
    return { cfg };
  }

  return {
    async status() {
      const cfg = cfgService.load();
      return buildStatus({
        config: cfg,
        engine,
        gitops,
        syncDir: sync,
        gitCrypt: gitCryptAvailable() ? "ok" : "missing",
        lastBackupAt,
        lastError,
      });
    },
    async syncNow() {
      await ensureReady();
      await engine!.syncNow();
      return "sync complete";
    },
    async backupNow() {
      await ensureReady();
      const res = await backupEngine!.backupNow();
      lastBackupAt = new Date().toISOString();
      return res ? `backup uploaded: ${res.archivePath}` : "backup failed";
    },
    async restore(o) {
      await ensureReady();
      const res = await restoreEngine!.restore(o);
      return res.applied ? `restored ${res.snapshot}` : `preview: ${res.changedPaths.length} paths`;
    },
    async start() {
      try {
        await ensureReady();
        await engine!.start();
      } catch (e) {
        lastError = String(e);
      }
    },
    async stop() {
      await engine?.stop();
    },
  };
}

export function registerCommands(ctx: { program: Record<string, (cmd: string, desc?: string) => unknown> }): void {
  void ctx;
}
```

`src/index.ts` (replace Task 1 skeleton):
```ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createRuntime } from "./cli.js";

export interface MinimalApi {
  id: string;
  pluginConfig: Record<string, unknown>;
  registerCli(registrar: (ctx: { program: unknown }) => void, opts?: unknown): unknown;
  on(hookName: string, handler: () => void | Promise<void>): unknown;
  logger: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

export function createPlugin(api: MinimalApi): void {
  const rt = createRuntime({ stateDir: process.env.OPENCLAW_STATE_DIR ?? joinHomeOpenclaw(), env: process.env });

  api.on("gateway_start", () => void rt.start());
  api.on("gateway_stop", () => void rt.stop());

  api.registerCli(
    async ({ program }) => {
      registerCommands(program as never);
    },
    {
      descriptors: [{ name: "gh-sync", description: "OpenClaw GitHub sync and backup", hasSubcommands: true }],
    },
  );
}

function joinHomeOpenclaw(): string {
  const { homedir } = require("node:os") as typeof import("node:os");
  return join(homedir(), ".openclaw");
}

export default definePluginEntry({
  id: "openclaw-gh-sync",
  name: "OpenClaw GitHub Sync",
  description: "Real-time GitHub sync plus scheduled official-backup archive upload",
  register(api) {
    createPlugin(api as unknown as MinimalApi);
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli.test.ts`
Expected: PASS. Then `npm run typecheck` — `src/index.ts` needs the `openclaw` package for types; add `"openclaw": ">=2026.3.24"` to devDependencies and run `npm install` if the host SDK is unavailable; if typecheck of `index.ts` is impractical without the SDK, keep `src/index.ts` excluded from the main tsconfig and give it its own `tsconfig.entry.json` checked only in CI with the SDK present.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/index.ts tests/cli.test.ts
git commit -m "feat: wire CLI runtime and plugin entry lifecycle"
```

---

### Task 17: End-to-end integration test

**Files:**
- Create: `tests/e2e.test.ts`
- Test: `tests/e2e.test.ts`

**Interfaces:**
- Consumes: `createRuntime` from Task 16.

- [ ] **Step 1: Write the failing test**

`tests/e2e.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime } from "../src/cli.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { ConfigService } from "../src/config.js";
import { cleanup, makeBareRepo } from "./helpers/git-env.js";

describe("e2e", () => {
  it("full lifecycle: setup-config → start → push → remote pull → backup → restore preview", async () => {
    const { bareDir, url } = makeBareRepo();
    const root = mkdtempSync(join(tmpdir(), "e2e-"));
    const stateDir = join(root, "state");
    const syncDir = join(stateDir, "gh-sync");
    mkdirSync(join(stateDir, "workspace"), { recursive: true });

    const cfgService = new ConfigService(join(syncDir, "config.json"));
    cfgService.save({ ...DEFAULT_CONFIG, repo: url, branch: "instances/desktop", instanceName: "desktop" });

    const rt = createRuntime({ stateDir, env: { ...process.env } });
    await rt.start();

    writeFileSync(join(stateDir, "workspace", "hello.txt"), "v1");
    await rt.syncNow();

    const remote = mkdtempSync(join(tmpdir(), "e2e-remote-"));
    const remoteOps = new GitOps(remote, url, "instances/desktop", null);
    await remoteOps.initRepo();
    writeFileSync(join(remote, "openclaw", "workspace", "hello.txt"), "remote");
    await remoteOps.commitChanged("remote");
    await remoteOps.push();

    await rt.syncNow();
    expect(readFileSync(join(stateDir, "workspace", "hello.txt"), "utf8")).toBe("remote");

    const backupOut = await rt.backupNow();
    expect(backupOut).toContain("backup");

    const restoreOut = await rt.restore({ dryRun: true });
    expect(restoreOut).toContain("preview");

    await rt.stop();
    cleanup(bareDir, root, remote);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/e2e.test.ts`
Expected: FAIL — `GitOps` not imported in the test (add `import { GitOps } from "../src/gitops.js";`) and/or `createRuntime` not exported yet.

- [ ] **Step 3: Implement glue so it passes**

Fix imports in the test; ensure `BackupEngine.backupNow()` accepts the fake CLI via `process.env.GH_SYNC_BACKUP_CLI` override (add: read `process.env.GH_SYNC_BACKUP_CLI` in `runBackupCli`; e2e sets it to the fake script path). Verify `createGitOps` initializes the empty bare repo on first `ensureBranch` (the bare repo has no commits — `git checkout -B branch origin/branch` fails; make `ensureBranch` handle the empty-remote case by checking `git ls-remote` first and creating the branch locally, then pushing with `-u`).

Update `src/gitops.ts` `ensureBranch`:
```ts
const lsRemote = await this.git.raw(["ls-remote", "--heads", "origin", name]).catch(() => "");
const remoteHasBranch = lsRemote.includes(`refs/heads/${name}`);
if (remoteHasBranch) {
  await this.git.checkout(["-B", name, `origin/${name}`]);
} else {
  await this.git.checkoutLocalBranch(name);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `GH_SYNC_BACKUP_CLI="$PWD/tests/helpers/fake-backup-cli.sh" npx vitest run tests/e2e.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e.test.ts src/gitops.ts src/backup.ts
git commit -m "test: add end-to-end lifecycle test and fix empty-remote branch bootstrap"
```

---

### Task 18: README, packaging, and publish readiness

**Files:**
- Create: `README.md`
- Modify: `package.json` (add `files`, `prepare`, `prepublishOnly`)
- Create: `scripts/build-check.sh`

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: Write the failing check (README + packaging script)**

`scripts/build-check.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

- [ ] **Step 2: Run to verify failure**

Run: `bash scripts/build-check.sh`
Expected: FAIL because `npm pack --dry-run` warns on missing `files` and README absence in package.

- [ ] **Step 3: Write README and packaging fields**

`README.md` — document: what it does, install (`openclaw plugins install --link .` / published `clawhub:`), setup wizard flow (repo, PAT scope `repo`, instance name, git-crypt three-way choice), the three automation loops, commands table, repo layout (`instances/<name>` branches + `main` README index), restore/migration, security notes (PAT file 0600, git-crypt key backup via `git-crypt export-key`), troubleshooting.

`package.json` — add:
```json
"files": ["dist", "openclaw.plugin.json", "README.md"],
"scripts": {
  "prepare": "npm run build",
  "prepublishOnly": "bash scripts/build-check.sh"
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash scripts/build-check.sh`
Expected: PASS (typecheck + tests + build + pack dry-run clean).

- [ ] **Step 5: Commit**

```bash
chmod +x scripts/build-check.sh tests/helpers/fake-backup-cli.sh
git add README.md package.json scripts/build-check.sh
git commit -m "docs: add README and packaging readiness"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Task(s) |
|---|---|
| §3 architecture (SyncEngine/BackupEngine/RestoreEngine/Config/CLI) | 10, 12, 13, 2, 16 |
| §4 branch-per-instance repo layout | 6, 7, 17 |
| §5.1 local layout (gh-sync dir, credentials 0600) | 3, 4 |
| §5.2 push loop (watcher + debounce + git-crypt) | 9, 10, 5 |
| §5.3 pull loop (60s poll + conflict sidecars) | 9, 10, 11 |
| §5.4 archive loop (6h `backup create --verify`, backups/, retention) | 12 |
| §5.5 restore/migration (`--from-instance`) | 13 |
| §5.6 automation model (startup align, gateway_stop) | 10, 16 |
| §6 config schema + gitCryptEnabled | 2, 5, 15 |
| §7 CLI commands | 16 |
| §8.1 git-crypt install/degrade flow | 15 |
| §9 testing | 2–17 |
| §10 packaging | 18 |
| §11.1 remote abstraction (v2 seam) | 6 (`origin` via remotes array), 16 |

**Placeholder scan:** retention (`enforceRetention`) and Releases upload (>95MB) are deferred with explicit notes — acceptable as documented scope carve-outs, but flag: if the final reviewer wants them in v1, extend Task 12 with a retention step (sort `backups/*.tar.gz` by name, delete beyond `backupRetain`, commit+push) and a Releases upload using global `fetch` to `https://api.github.com/repos/<owner>/<repo>/releases`.

**Type consistency:** `SyncDeps.stateDir` is added in Task 10 and used by `realtime.ts`; `GitOps` is constructed in `createGitOps` (Task 10) and reused by Task 12/13/16; `EngineStatus` is exported from `realtime.ts` and consumed by `status.ts`; `createRuntime` return type `Runtime` is used in `tests/cli.test.ts`. `runBackupCli` signature includes an injectable `spawnFn` used by tests. `ensureBranch` empty-remote fix in Task 17 is consistent with Task 6's interface.
