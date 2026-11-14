// Ticket 3b-1 — read the "photo taken" time from a JPEG header (BRD v1.6 §20C).
//
// Small, dependency-free and defensive: it reads ONLY DateTimeOriginal (and
// its time-zone offset, if present) from the EXIF block, never location, and
// returns null on anything unexpected — missing EXIF, cut-off data, junk.
// EXIF can be faked, so this only feeds a flag for the human check.

export interface ExifTakenAt {
  /** The moment the photo was taken. UTC if the file carried no offset. */
  takenAt: Date;
  /** False when the file gave no time zone; the time is then read as UTC. */
  hasOffset: boolean;
}

const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TYPE_ASCII = 2;
const TYPE_LONG = 4;
const MAX_MARKERS = 64;
const MAX_IFD_ENTRIES = 512;

class Reader {
  bytes: Uint8Array;
  start: number;
  little: boolean;
  constructor(bytes: Uint8Array, start: number, little: boolean) {
    this.bytes = bytes;
    this.start = start;
    this.little = little;
  }
  ok(offset: number, length: number): boolean {
    return offset >= 0 && length >= 0 && this.start + offset + length <= this.bytes.length;
  }
  u16(offset: number): number {
    const a = this.bytes[this.start + offset];
    const b = this.bytes[this.start + offset + 1];
    return this.little ? a | (b << 8) : (a << 8) | b;
  }
  u32(offset: number): number {
    const b0 = this.bytes[this.start + offset];
    const b1 = this.bytes[this.start + offset + 1];
    const b2 = this.bytes[this.start + offset + 2];
    const b3 = this.bytes[this.start + offset + 3];
    return this.little
      ? (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0
      : ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
  }
  ascii(offset: number, length: number): string {
    let s = "";
    for (let i = 0; i < length; i += 1) {
      const c = this.bytes[this.start + offset + i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
}

interface IfdEntry {
  type: number;
  count: number;
  valueOffset: number; // offset of the 4-byte value / pointer field
}

function readIfd(r: Reader, ifdOffset: number): Map<number, IfdEntry> | null {
  if (!r.ok(ifdOffset, 2)) return null;
  const n = r.u16(ifdOffset);
  if (n > MAX_IFD_ENTRIES || !r.ok(ifdOffset + 2, n * 12)) return null;
  const entries = new Map<number, IfdEntry>();
  for (let i = 0; i < n; i += 1) {
    const at = ifdOffset + 2 + i * 12;
    entries.set(r.u16(at), { type: r.u16(at + 2), count: r.u32(at + 4), valueOffset: at + 8 });
  }
  return entries;
}

function readAscii(r: Reader, e: IfdEntry | undefined): string | null {
  if (!e || e.type !== TYPE_ASCII || e.count === 0 || e.count > 64) return null;
  const offset = e.count <= 4 ? e.valueOffset : r.u32(e.valueOffset);
  if (!r.ok(offset, e.count)) return null;
  return r.ascii(offset, e.count);
}

/** "YYYY:MM:DD HH:MM:SS" (+ optional "±HH:MM") → Date, or null if not sane. */
export function parseExifDateTime(value: string, offset: string | null): ExifTakenAt | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  let ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(ms);
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return null; // e.g. 31 Feb
  const o = offset ? /^([+-])(\d{2}):(\d{2})$/.exec(offset.trim()) : null;
  if (o) {
    const sign = o[1] === "+" ? 1 : -1;
    const mins = Number(o[2]) * 60 + Number(o[3]);
    if (mins > 14 * 60) return null;
    ms -= sign * mins * 60_000;
  }
  return { takenAt: new Date(ms), hasOffset: Boolean(o) };
}

/** The "photo taken" time from a JPEG's EXIF, or null. Never throws. */
export function readExifTakenAt(bytes: Uint8Array): ExifTakenAt | null {
  try {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let pos = 2;
    for (let markers = 0; markers < MAX_MARKERS && pos + 4 <= bytes.length; markers += 1) {
      if (bytes[pos] !== 0xff) return null;
      const marker = bytes[pos + 1];
      if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan
      const length = (bytes[pos + 2] << 8) | bytes[pos + 3];
      if (length < 2) return null;
      const segStart = pos + 4;
      const segEnd = pos + 2 + length;
      if (marker === 0xe1 && segEnd <= bytes.length && length >= 16) {
        const isExif =
          bytes[segStart] === 0x45 && bytes[segStart + 1] === 0x78 && bytes[segStart + 2] === 0x69 &&
          bytes[segStart + 3] === 0x66 && bytes[segStart + 4] === 0 && bytes[segStart + 5] === 0;
        if (isExif) return readTiff(bytes.subarray(0, segEnd), segStart + 6);
      }
      pos = segEnd;
    }
    return null;
  } catch {
    return null;
  }
}

function readTiff(bytes: Uint8Array, tiffStart: number): ExifTakenAt | null {
  if (tiffStart + 8 > bytes.length) return null;
  const order = String.fromCharCode(bytes[tiffStart], bytes[tiffStart + 1]);
  if (order !== "II" && order !== "MM") return null;
  const r = new Reader(bytes, tiffStart, order === "II");
  if (r.u16(2) !== 42) return null;
  const ifd0 = readIfd(r, r.u32(4));
  const pointer = ifd0?.get(TAG_EXIF_IFD);
  if (!pointer || pointer.type !== TYPE_LONG || pointer.count !== 1) return null;
  const exif = readIfd(r, r.u32(pointer.valueOffset));
  if (!exif) return null;
  const when = readAscii(r, exif.get(TAG_DATE_TIME_ORIGINAL));
  if (!when) return null;
  return parseExifDateTime(when, readAscii(r, exif.get(TAG_OFFSET_TIME_ORIGINAL)));
}

/** What the bytes actually are, from their first bytes (never trust the browser's label). */
export function sniffImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}
