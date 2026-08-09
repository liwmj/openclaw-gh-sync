import { describe, expect, it } from "vitest";
import { createRuntime, type Runtime } from "../src/cli.js";

describe("CLI runtime", () => {
  it("is unconfigured before setup", async () => {
    const rt: Runtime = createRuntime({ stateDir: "/tmp/none", env: {} });
    const status = await rt.status();
    expect(status.configured).toBe(false);
  });
});
