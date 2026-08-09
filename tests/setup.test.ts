import { describe, expect, it } from "vitest";
import { planForSetup } from "../src/setup.js";

describe("planForSetup", () => {
  it("initializes git-crypt when available", () => {
    const plan = planForSetup({ instanceNameRaw: "My Desktop!", repo: "https://github.com/u/r.git", gitCryptAvailable: true, gitCryptEnabled: true });
    expect(plan.instanceName).toBe("my-desktop");
    expect(plan.branch).toBe("instances/my-desktop");
    expect(plan.gitCryptAction).toBe("init");
  });
  it("skips sensitive sync when git-crypt missing but enabled", () => {
    const plan = planForSetup({ instanceNameRaw: "box", repo: "https://github.com/u/r.git", gitCryptAvailable: false, gitCryptEnabled: true });
    expect(plan.gitCryptAction).toBe("skip-sensitive");
  });
});
