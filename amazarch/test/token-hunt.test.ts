import { describe, expect, it } from "vitest";
import {
  describeStorageForDiagnostics,
  huntMonarchToken,
} from "../src/shared/monarch-session";

const TOKEN = "abcdef0123456789abcdef0123456789";

describe("huntMonarchToken", () => {
  it("finds the classic persist:root.user.token", () => {
    const entries = {
      "persist:root": JSON.stringify({ user: JSON.stringify({ token: TOKEN }) }),
    };
    expect(huntMonarchToken(entries)).toEqual({
      token: TOKEN,
      strategy: "persist:root.user.token",
    });
  });

  it("finds a token in a renamed persist slice", () => {
    const entries = {
      "persist:auth": JSON.stringify({ session: JSON.stringify({ accessToken: TOKEN }) }),
    };
    expect(huntMonarchToken(entries)).toEqual({ token: TOKEN, strategy: "persist:auth.session" });
  });

  it("finds a token in a persist slice stored as a plain object", () => {
    const entries = {
      "persist:root": JSON.stringify({ user: { token: TOKEN } }),
    };
    expect(huntMonarchToken(entries)).toEqual({ token: TOKEN, strategy: "persist:root.user" });
  });

  it("finds bare token-ish localStorage keys", () => {
    expect(huntMonarchToken({ token: TOKEN })).toEqual({
      token: TOKEN,
      strategy: "localStorage.token",
    });
    expect(huntMonarchToken({ authToken: `"${TOKEN}"` })).toEqual({
      token: TOKEN,
      strategy: "localStorage.authToken",
    });
  });

  it("ignores short strings that cannot be tokens", () => {
    const entries = {
      "persist:root": JSON.stringify({ user: JSON.stringify({ token: "short" }) }),
      token: "abc",
    };
    expect(huntMonarchToken(entries)).toEqual({ token: null, strategy: null });
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
  it("reports key names and persist shapes but never values", () => {
    const out = describeStorageForDiagnostics({
      "persist:root": JSON.stringify({ user: "\"secret\"", flags: "{}" }),
      monarchDeviceUUID: "1234",
    });
    expect(out.keys).toEqual(["monarchDeviceUUID", "persist:root"]);
    expect(out.persistShapes).toEqual({ "persist:root": ["flags", "user"] });
    expect(JSON.stringify(out)).not.toContain("secret");
    expect(JSON.stringify(out)).not.toContain("1234");
  });
});
