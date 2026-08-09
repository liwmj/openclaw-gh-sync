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
