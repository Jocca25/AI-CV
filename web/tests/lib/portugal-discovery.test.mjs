import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PORTUGAL_PRESET, portugalRequest, PORTUGAL_SOURCES } from "../../src/lib/portugal-preset.mjs";

describe("portugal-preset", () => {
  it("exports a stable preset id and sources", () => {
    assert.equal(PORTUGAL_PRESET, "portugal");
    assert.ok(PORTUGAL_SOURCES.includes("landingjobs"));
    assert.ok(PORTUGAL_SOURCES.includes("okemprego"));
  });

  it("portugalRequest accepts the portugal preset only", () => {
    assert.deepEqual(portugalRequest({ preset: "portugal" }), { preset: "portugal" });
    assert.throws(() => portugalRequest({ preset: "china-employers" }), /Unknown Portugal preset/);
  });
});
