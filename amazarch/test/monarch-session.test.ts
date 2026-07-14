import { describe, expect, it } from "vitest";
import { extractDeviceUuid, extractMonarchToken } from "../src/shared/monarch-session";

function persistRoot(user: unknown): string {
  return JSON.stringify({ user: JSON.stringify(user), other: "{}" });
}

describe("extractMonarchToken", () => {
  it("extracts the token from a realistic persist:root", () => {
    expect(extractMonarchToken(persistRoot({ token: "abc123", id: "u1" }))).toBe("abc123");
  });

  it("returns null when localStorage key is absent", () => {
    expect(extractMonarchToken(null)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(extractMonarchToken("{not json")).toBeNull();
    expect(extractMonarchToken(JSON.stringify({ user: "{broken" }))).toBeNull();
  });

  it("returns null when logged out (no token / empty token)", () => {
    expect(extractMonarchToken(persistRoot({ token: null }))).toBeNull();
    expect(extractMonarchToken(persistRoot({ token: "" }))).toBeNull();
    expect(extractMonarchToken(persistRoot({}))).toBeNull();
  });

  it("returns null when user slice is not the expected double-encoded string", () => {
    expect(extractMonarchToken(JSON.stringify({ user: { token: "abc" } }))).toBeNull();
    expect(extractMonarchToken(JSON.stringify("just a string"))).toBeNull();
  });
});

describe("extractDeviceUuid", () => {
  it("handles bare and JSON-quoted values", () => {
    expect(extractDeviceUuid("1234-5678")).toBe("1234-5678");
    expect(extractDeviceUuid('"1234-5678"')).toBe("1234-5678");
  });

  it("returns null for absent/empty", () => {
    expect(extractDeviceUuid(null)).toBeNull();
    expect(extractDeviceUuid('""')).toBeNull();
  });
});
