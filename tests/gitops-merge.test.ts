import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
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

  it("force-accepts remote and saves local sidecar when uncommitted change blocks fast-forward", async () => {
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
    const out = await a.pull();
    expect(out.status).toBe("ok");
    expect(readFileSync(join(a.syncDir, "openclaw", "f.txt"), "utf8")).toBe("remote");
    const sidecars = readdirSync(join(a.syncDir, "openclaw")).filter((n) => n.includes(".local."));
    expect(sidecars.length).toBe(1);
    cleanup(bareDir, a.syncDir, b.syncDir);
  });

  it("merges remote changes when local and remote both committed", async () => {
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
    expect(out.status).toBe("ok");
    expect(readFileSync(join(a.syncDir, "openclaw", "f.txt"), "utf8")).toBe("remote");
    cleanup(bareDir, a.syncDir, b.syncDir);
  });
});
