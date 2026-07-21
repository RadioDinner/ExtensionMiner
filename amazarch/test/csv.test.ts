import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/shared/csv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with commas and escaped quotes", () => {
    expect(parseCsv('name,note\n"Doe, John","he said ""hi"""')).toEqual([
      ["name", "note"],
      ["Doe, John", 'he said "hi"'],
    ]);
  });

  it("handles newlines inside quoted fields", () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([
      ["a", "b"],
      ["line1\nline2", "x"],
    ]);
  });

  it("handles CRLF line endings and a UTF-8 BOM", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty trailing fields but drops a blank trailing line", () => {
    expect(parseCsv("a,b,\n1,,3\n")).toEqual([
      ["a", "b", ""],
      ["1", "", "3"],
    ]);
  });

  it("returns a single row when there is no newline", () => {
    expect(parseCsv("solo")).toEqual([["solo"]]);
    expect(parseCsv("")).toEqual([]);
  });
});
