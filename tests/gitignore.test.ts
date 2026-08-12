import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitOps } from "../src/gitops.js";
import { makeBareRepo, cleanup } from "./helpers/git-env.js";

const FAKE_REPO = "https://github.com/gh-sync-test/local";
const MANAGED_START = "# ===== gh-sync managed start =====";
const MANAGED_END = "# ===== gh-sync managed end =====";

function makeOps(overrides: { gitignoreExtras?: string[]; forceInclude?: string[] } = {}) {
  const { bareDir, url } = makeBareRepo();
  const dir = mkdtempSync(join(tmpdir(), "gitignore-"));
  // 先 init 再设置 insteadOf，把 FAKE_REPO 映射到本地 bare repo，避免 initRepo 的 fetch 走真实网络
  execFileSync("git", ["init", dir], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", `url.${bareDir}.insteadOf`, FAKE_REPO], { stdio: "ignore" });
  const ops = new GitOps(dir, FAKE_REPO, "instances/desktop", null, 30_000, overrides.gitignoreExtras ?? [], overrides.forceInclude ?? []);
  return { dir, ops, bareDir, url };
}

function gitignoreOf(dir: string): string {
  return readFileSync(join(dir, ".gitignore"), "utf8");
}

describe(".gitignore managed block", () => {
  it("default rules are written on init and unchanged when no extras/forceInclude", async () => {
    const { dir, ops, bareDir } = makeOps();
    try {
      await ops.initRepo();
      const content = gitignoreOf(dir);
      expect(content).toContain(".git-credentials");
      expect(content).toContain("backups/*");
      expect(content).toContain("!backups/*.tar.gz");
      expect(content).toContain("*.jsonl");
      expect(content).toContain(MANAGED_START);
      expect(content).toContain(MANAGED_END);
      // 无配置时不含反选/追加
      expect(content).not.toContain("!**/*.jsonl");
      expect(content).not.toContain("*.tmp");
    } finally {
      cleanup(bareDir, dir);
    }
  });

  it("forceInclude generates ! negations after default ignores so jsonl can be synced", async () => {
    const { dir, ops, bareDir } = makeOps({ forceInclude: ["**/*.jsonl"] });
    try {
      await ops.initRepo();
      const content = gitignoreOf(dir);
      // 默认忽略在前，反选在后（gitignore 后者覆盖前者）
      const ignoreIdx = content.indexOf("*.jsonl");
      const negateIdx = content.indexOf("!**/*.jsonl");
      expect(ignoreIdx).toBeGreaterThan(-1);
      expect(negateIdx).toBeGreaterThan(ignoreIdx);
    } finally {
      cleanup(bareDir, dir);
    }
  });

  it("gitignoreExtras are appended inside the managed block", async () => {
    const { dir, ops, bareDir } = makeOps({ gitignoreExtras: ["*.tmp"] });
    try {
      await ops.initRepo();
      const content = gitignoreOf(dir);
      expect(content).toContain("*.tmp");
      const extraIdx = content.indexOf("*.tmp");
      const startIdx = content.indexOf(MANAGED_START);
      const endIdx = content.indexOf(MANAGED_END);
      expect(extraIdx).toBeGreaterThan(startIdx);
      expect(extraIdx).toBeLessThan(endIdx);
    } finally {
      cleanup(bareDir, dir);
    }
  });

  it("user custom rules outside the managed block are preserved across rewrites", async () => {
    const { dir, ops, bareDir } = makeOps({ forceInclude: ["**/*.jsonl"] });
    try {
      await ops.initRepo();
      // 用户在 managed 区外追加自定义规则
      const p = join(dir, ".gitignore");
      writeFileSync(p, gitignoreOf(dir) + "\n# my custom rule\ncustom-dir/\n");
      // 再次 init（模拟升级后重写）
      await ops.initRepo();
      const content = gitignoreOf(dir);
      expect(content).toContain("# my custom rule");
      expect(content).toContain("custom-dir/");
      // managed 区仍完整且含 forceInclude
      expect(content).toContain(MANAGED_START);
      expect(content).toContain("!**/*.jsonl");
    } finally {
      cleanup(bareDir, dir);
    }
  });

  it("managed block is idempotent across repeated inits (no duplicate blocks)", async () => {
    const { dir, ops, bareDir } = makeOps({ forceInclude: ["**/*.jsonl"] });
    try {
      await ops.initRepo();
      await ops.initRepo();
      await ops.initRepo();
      const content = gitignoreOf(dir);
      const starts = content.split(MANAGED_START).length - 1;
      expect(starts).toBe(1);
    } finally {
      cleanup(bareDir, dir);
    }
  });
});

describe(".gitignore conflict sidecar rules", () => {
  it("conflict sidecar files (all five naming patterns) are ignored", async () => {
    const { dir, ops, bareDir } = makeOps();
    try {
      await ops.initRepo();
      const content = gitignoreOf(dir);
      for (const pat of ["*.conflict.*", "*.local-conflict.*", "*.peer-conflict.*", "*.local.*", "*.theirs.*"]) {
        expect(content).toContain(pat);
      }
      // 实际验证 git 忽略生效
      const { execFileSync } = await import("node:child_process");
      writeFileSync(join(dir, "f.conflict.1789"), "x");
      writeFileSync(join(dir, "f.local-conflict.1789"), "x");
      writeFileSync(join(dir, "f.peer-conflict.1789"), "x");
      writeFileSync(join(dir, "f.local.1789"), "x");
      writeFileSync(join(dir, "f.theirs.1789"), "x");
      writeFileSync(join(dir, "normal.txt"), "x");
      execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
      const tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8" });
      expect(tracked).toContain("normal.txt");
      expect(tracked).not.toContain("f.conflict.");
      expect(tracked).not.toContain("f.local-conflict.");
      expect(tracked).not.toContain("f.peer-conflict.");
      expect(tracked).not.toContain("f.local.");
      expect(tracked).not.toContain("f.theirs.");
    } finally {
      cleanup(bareDir, dir);
    }
  });
});
