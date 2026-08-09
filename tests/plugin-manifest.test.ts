import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SyncConfig } from "../src/types.js";

describe("openclaw.plugin.json", () => {
  const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8")) as {
    configSchema: { type: string; properties: Record<string, unknown>; additionalProperties: boolean };
  };

  it("configSchema covers every SyncConfig field", () => {
    const fields: (keyof SyncConfig)[] = [
      "repo", "branch", "instanceName", "include", "exclude",
      "pushDebounceMs", "pollIntervalSec", "backupIntervalH", "backupRetain", "gitCryptEnabled",
      "syncStrategy",
    ];
    const expected = [...fields].sort();
    const actual = Object.keys(manifest.configSchema.properties).sort();
    expect(actual).toEqual(expected);
  });

  it("configSchema disallows unknown keys", () => {
    expect(manifest.configSchema.additionalProperties).toBe(false);
  });

  it("configSchema is a valid JSON object", () => {
    expect(manifest.configSchema.type).toBe("object");
  });
});
