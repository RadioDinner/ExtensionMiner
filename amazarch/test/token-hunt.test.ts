import { describe, expect, it } from "vitest";
import {
  classifyString,
  describeStorageForDiagnostics,
  huntMonarchToken,
} from "../src/shared/monarch-session";

const HEX40 = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

function persistRoot(user: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ user: JSON.stringify(user), _persist: '{"version":-1}', ...extra });
}

describe("classifyString", () => {
  it("classifies token-ish shapes", () => {
    expect(classifyString(HEX40)).toBe("hex40");
    expect(classifyString(JWT)).toBe("jwt");
    expect(classifyString("11111111-2222-3333-4444-555555555555")).toBe("uuid");
    expect(classifyString("someone@example.com")).toBe("email");
    expect(classifyString("https://x.test/a")).toBe("url");
    expect(classifyString("short")).toBe("other");
  });
});

describe("huntMonarchToken", () => {
  it("finds the classic persist:root.user.token fast path", () => {
    const entries = { "persist:root": persistRoot({ token: HEX40, id: "u1" }) };
    expect(huntMonarchToken(entries)).toEqual({ token: HEX40, strategy: "persist:root.user.token" });
  });

  it("finds a token under a renamed field by shape (JWT)", () => {
    const entries = { "persist:auth": JSON.stringify({ credentials: JSON.stringify({ bearer: JWT }) }) };
    const hunt = huntMonarchToken(entries);
    expect(hunt.token).toBe(JWT);
    expect(hunt.strategy).toBe("persist:auth.credentials.bearer");
  });

  it("prefers a token-named field over an equally-shaped decoy", () => {
    const entries = {
      "persist:root": persistRoot({ token: HEX40, someHash: "f".repeat(40) }),
    };
    expect(huntMonarchToken(entries).token).toBe(HEX40);
  });

  it("ignores the device UUID, oAuthStateString, and csrf decoys", () => {
    const entries = {
      "persist:auth": JSON.stringify({
        oAuthStateString: JWT, // long but a state string, not the token
        _persist: '{"version":-1}',
      }),
      monarchDeviceUUID: "11111111-2222-3333-4444-555555555555",
      csrftoken: HEX40,
    };
    expect(huntMonarchToken(entries)).toEqual({ token: null, strategy: null });
  });

  it("never mistakes an unrelated widget's *userToken key (not a searched container)", () => {
    const entries = { "gist.web.userToken": HEX40 };
    expect(huntMonarchToken(entries)).toEqual({ token: null, strategy: null });
  });

  it("finds a bare token localStorage key", () => {
    expect(huntMonarchToken({ token: HEX40 })).toEqual({ token: HEX40, strategy: "token" });
  });

  it("returns null on empty/garbage storage", () => {
    expect(huntMonarchToken({})).toEqual({ token: null, strategy: null });
    expect(huntMonarchToken({ "persist:root": "{broken", other: "1" })).toEqual({
      token: null,
      strategy: null,
    });
  });
});

describe("describeStorageForDiagnostics", () => {
  it("reports key names, persist shapes, and a value-free field fingerprint", () => {
    const entries = {
      "persist:root": persistRoot({ token: HEX40, email: "me@x.test" }, { flags: "{}" }),
      monarchDeviceUUID: "1234",
    };
    const out = describeStorageForDiagnostics(entries);
    expect(out.keys).toContain("persist:root");
    expect(out.persistShapes["persist:root"]).toEqual(["_persist", "flags", "user"]);
    // fingerprint exposes the shape/length of the token field but not its value
    expect(out.fingerprint["persist:root.user.token"]).toBe(`hex40/${HEX40.length}`);
    expect(JSON.stringify(out)).not.toContain(HEX40);
    expect(JSON.stringify(out)).not.toContain("me@x.test");
  });
});
