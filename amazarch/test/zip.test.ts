import { describe, expect, it } from "vitest";
import { readZipEntries } from "../src/shared/zip";

// Build a real ZIP in-memory (CRC left 0 — the reader doesn't verify it) so the
// reader is tested end-to-end for both stored and deflate entries.
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([new Uint8Array(data)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function buildZip(files: { name: string; text: string }[], compress: boolean): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (a: Uint8Array): void => {
    chunks.push(a);
    offset += a.length;
  };
  const records: { nameBytes: Uint8Array; method: number; compSize: number; uncompSize: number; localOffset: number }[] = [];

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const raw = enc.encode(f.text);
    const method = compress ? 8 : 0;
    const stored = compress ? await deflateRaw(raw) : raw;
    const localOffset = offset;
    const lh = new Uint8Array(30 + nameBytes.length);
    const ldv = new DataView(lh.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint16(4, 20, true);
    ldv.setUint16(8, method, true);
    ldv.setUint32(18, stored.length, true);
    ldv.setUint32(22, raw.length, true);
    ldv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);
    push(lh);
    push(stored);
    records.push({ nameBytes, method, compSize: stored.length, uncompSize: raw.length, localOffset });
  }

  const cdStart = offset;
  for (const r of records) {
    const ch = new Uint8Array(46 + r.nameBytes.length);
    const cdv = new DataView(ch.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(10, r.method, true);
    cdv.setUint32(20, r.compSize, true);
    cdv.setUint32(24, r.uncompSize, true);
    cdv.setUint16(28, r.nameBytes.length, true);
    cdv.setUint32(42, r.localOffset, true);
    ch.set(r.nameBytes, 46);
    push(ch);
  }
  const cdSize = offset - cdStart;
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, records.length, true);
  edv.setUint16(10, records.length, true);
  edv.setUint32(12, cdSize, true);
  edv.setUint32(16, cdStart, true);
  push(eocd);

  const total = new Uint8Array(offset);
  let p = 0;
  for (const c of chunks) {
    total.set(c, p);
    p += c.length;
  }
  return total;
}

const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

describe("readZipEntries", () => {
  it("reads STORED (uncompressed) entries", async () => {
    const zip = await buildZip(
      [
        { name: "Retail.OrderHistory.1/Retail.OrderHistory.1.csv", text: "Order ID,Order Date\nA,2024-01-01" },
        { name: "readme.txt", text: "hello" },
      ],
      false,
    );
    const entries = await readZipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual([
      "Retail.OrderHistory.1/Retail.OrderHistory.1.csv",
      "readme.txt",
    ]);
    expect(dec(entries[0]!.bytes)).toContain("Order ID,Order Date");
    expect(dec(entries[1]!.bytes)).toBe("hello");
  });

  it("reads DEFLATE-compressed entries", async () => {
    const body = "Order ID,Order Date,Total Owed\n" + Array.from({ length: 50 }, (_, i) => `X-${i},2024-01-01,1.00`).join("\n");
    const zip = await buildZip([{ name: "Retail.OrderHistory.1.csv", text: body }], true);
    const entries = await readZipEntries(zip);
    expect(entries).toHaveLength(1);
    expect(dec(entries[0]!.bytes)).toBe(body);
  });

  it("throws on non-ZIP bytes", async () => {
    await expect(readZipEntries(new TextEncoder().encode("not a zip"))).rejects.toThrow(/not a zip/i);
  });
});
