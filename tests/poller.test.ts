import { describe, expect, it } from "vitest";
import { Poller } from "../src/poller.js";

describe("Poller", () => {
  it("ticks at interval and stops", async () => {
    let ticks = 0;
    const poller = new Poller(30, async () => {
      ticks += 1;
    });
    poller.start();
    await new Promise((r) => setTimeout(r, 120));
    poller.stop();
    expect(ticks).toBeGreaterThanOrEqual(3);
    const after = ticks;
    await new Promise((r) => setTimeout(r, 60));
    expect(ticks).toBe(after);
  });
});
