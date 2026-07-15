import { describe, expect, it } from "vitest";
import { readCookie } from "../src/shared/monarch-probe";

describe("readCookie", () => {
  const jar = "monarchDeviceUUID=abc-123; csrftoken=Zx9YtokenValue; _dd_s=rum=0";

  it("reads a named cookie value", () => {
    expect(readCookie(jar, "csrftoken")).toBe("Zx9YtokenValue");
    expect(readCookie(jar, "monarchDeviceUUID")).toBe("abc-123");
  });

  it("returns null for absent cookies", () => {
    expect(readCookie(jar, "sessionid")).toBeNull();
    expect(readCookie("", "csrftoken")).toBeNull();
  });

  it("handles values containing '='", () => {
    expect(readCookie("k=a=b=c", "k")).toBe("a=b=c");
  });
});
