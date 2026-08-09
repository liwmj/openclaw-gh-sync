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
