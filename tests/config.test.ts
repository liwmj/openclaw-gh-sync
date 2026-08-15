import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
    const cfg = {
      ...DEFAULT_CONFIG,
      repo: "https://github.com/u/r.git",
      instanceName: "desktop",
      branch: "instances/desktop",
    };
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
