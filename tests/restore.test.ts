import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
