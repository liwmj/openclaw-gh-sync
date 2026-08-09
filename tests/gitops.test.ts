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

describe("GitOps instance branch operations", () => {
  it("pushes the current branch and fetches a named remote branch", async () => {
    const { bareDir, url } = makeBareRepo();
    const a = makeWorkDir();
    const opsA = new GitOps(a, url, "main", null);
    await opsA.initRepo();
    writeFileSync(join(a, "x.txt"), "hi");
    await opsA.commitChanged("initial");
    await opsA.push();
    await opsA.ensureBranch("instances/dev");
    writeFileSync(join(a, "dev.txt"), "dev");
    await opsA.commitChanged("dev change");
    await opsA.pushCurrent();
    const b = makeWorkDir();
    const opsB = new GitOps(b, url, "main", null);
    await opsB.initRepo();
    expect(await opsB.fetchBranch("instances/dev")).toBe(true);
    expect(await opsB.fetchBranch("instances/missing")).toBe(false);
    cleanup(bareDir, a, b);
  });
});
