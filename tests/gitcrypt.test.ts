import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
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
