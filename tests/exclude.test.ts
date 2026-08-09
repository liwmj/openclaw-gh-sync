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
