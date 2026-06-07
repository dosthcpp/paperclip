import { describe, expect, it } from "vitest";
import { sessionCodec } from "./index.js";

describe("hermes sessionCodec round-trip", () => {
  it("serializes and re-deserializes a sessionId + cwd pair losslessly", () => {
    const params = { sessionId: "sess-abc123", cwd: "/Volumes/Data/work" };
    const serialized = sessionCodec.serialize(params);
    expect(serialized).toEqual({ sessionId: "sess-abc123", cwd: "/Volumes/Data/work" });
    expect(sessionCodec.deserialize(serialized)).toEqual(params);
  });

  it("accepts the legacy session_id key on deserialize", () => {
    expect(sessionCodec.deserialize({ session_id: "sess-legacy" })).toEqual({
      sessionId: "sess-legacy",
    });
  });

  it("drops an empty cwd rather than persisting it", () => {
    expect(sessionCodec.serialize({ sessionId: "sess-x", cwd: "   " })).toEqual({
      sessionId: "sess-x",
    });
  });

  it("returns null when no usable sessionId is present", () => {
    expect(sessionCodec.serialize({ cwd: "/tmp" })).toBeNull();
    expect(sessionCodec.serialize(null)).toBeNull();
    expect(sessionCodec.deserialize({})).toBeNull();
    expect(sessionCodec.deserialize(null)).toBeNull();
    expect(sessionCodec.deserialize(["sess-arr"])).toBeNull();
  });

  it("exposes the sessionId as the display id", () => {
    expect(sessionCodec.getDisplayId!({ sessionId: "sess-abc123", cwd: "/x" })).toBe("sess-abc123");
    expect(sessionCodec.getDisplayId!(null)).toBeNull();
  });
});
