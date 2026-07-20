import { describe, expect, it } from "vitest";
import { parseAmazonAccountLabel } from "../src/shared/amazon-account";

describe("parseAmazonAccountLabel", () => {
  it("extracts the name from a signed-in greeting", () => {
    expect(parseAmazonAccountLabel("Hello, Derrick")).toBe("Derrick");
    expect(parseAmazonAccountLabel("Hello Derrick")).toBe("Derrick");
    expect(parseAmazonAccountLabel("  Hello,   Sarah W  ")).toBe("Sarah W");
    expect(parseAmazonAccountLabel("Hola, María")).toBe("María");
  });

  it("returns null for signed-out / placeholder greetings", () => {
    expect(parseAmazonAccountLabel("Hello, sign in")).toBeNull();
    expect(parseAmazonAccountLabel("Hello, Sign In")).toBeNull();
    expect(parseAmazonAccountLabel("Hello, Identify yourself")).toBeNull();
    expect(parseAmazonAccountLabel("Account & Lists")).toBeNull();
    expect(parseAmazonAccountLabel("Sign in")).toBeNull();
  });

  it("returns null for empty/missing input", () => {
    expect(parseAmazonAccountLabel(null)).toBeNull();
    expect(parseAmazonAccountLabel(undefined)).toBeNull();
    expect(parseAmazonAccountLabel("")).toBeNull();
    expect(parseAmazonAccountLabel("   ")).toBeNull();
    expect(parseAmazonAccountLabel("Hello,")).toBeNull();
  });

  it("caps very long names", () => {
    expect(parseAmazonAccountLabel(`Hello, ${"x".repeat(100)}`)).toHaveLength(40);
  });
});
