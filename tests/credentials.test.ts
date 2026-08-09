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
