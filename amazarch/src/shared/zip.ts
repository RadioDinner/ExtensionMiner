// Minimal, dependency-free ZIP reader for the Amazon "Request My Data" export.
// Parses the central directory (reliable compressed sizes + offsets) and inflates
// DEFLATE entries with the browser's built-in DecompressionStream — no library,
// so the AMO source review stays trivial. Handles stored (method 0) and deflate
// (method 8); ignores ZIP64 (Amazon order exports are far under 4GB). Async
// because inflate is streaming.

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;

/** Read every file entry from a ZIP archive. Throws if the bytes aren't a ZIP. */
export async function readZipEntries(data: Uint8Array): Promise<ZipEntry[]> {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEocd(dv, data.length);
  if (eocd < 0) throw new Error("Not a ZIP file (no end-of-central-directory record).");

  const count = dv.getUint16(eocd + 10, true);
  let cd = dv.getUint32(eocd + 16, true); // central directory start offset
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (cd + 46 > data.length || dv.getUint32(cd, true) !== CDIR_SIG) break;
    // Central-directory file header field offsets (ZIP APPNOTE 4.3.12):
    // name-len @28, extra-len @30, comment-len @32, local-header-offset @42.
    const method = dv.getUint16(cd + 10, true);
    const compSize = dv.getUint32(cd + 20, true);
    const nameLen = dv.getUint16(cd + 28, true);
    const extraLen = dv.getUint16(cd + 30, true);
    const commentLen = dv.getUint16(cd + 32, true);
    const localOff = dv.getUint32(cd + 42, true);
    const name = decodeUtf8(data.subarray(cd + 46, cd + 46 + nameLen));

    // Jump to the local header to find where the data actually starts (its name
    // + extra lengths can differ from the central directory's).
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = data.subarray(dataStart, dataStart + compSize);

    if (method === 0) {
      entries.push({ name, bytes: comp });
    } else if (method === 8) {
      entries.push({ name, bytes: await inflateRaw(comp) });
    }
    // other methods (e.g. bzip2) are skipped — Amazon uses store/deflate.

    cd += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function findEocd(dv: DataView, length: number): number {
  // EOCD is 22 bytes + up to a 65535-byte comment; scan backwards for its sig.
  const minStart = Math.max(0, length - 22 - 0xffff);
  for (let i = length - 22; i >= minStart; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

async function inflateRaw(comp: Uint8Array): Promise<Uint8Array> {
  // Copy into a fresh ArrayBuffer-backed view so the Blob part type is exact
  // (a subarray is Uint8Array<ArrayBufferLike>, which BlobPart rejects).
  const part = new Uint8Array(comp);
  const stream = new Blob([part]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
