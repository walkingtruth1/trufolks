// Ticket 3b-1 — shared helpers for receipt tests. Test-only; not imported by app code.
import type { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";

/** Wrap a PGlite instance in the app's Sql surface. */
export function pgliteSql(pg: PGlite): Sql {
  const run = async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows;
  const tagged = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  tagged.query = run;
  return tagged;
}

/** Build a minimal JPEG whose EXIF holds DateTimeOriginal (+ optional offset). */
export function jpegWithExif(opts: { little: boolean; when: string; offset?: string }): Uint8Array {
  const entries: { tag: number; value: string }[] = [{ tag: 0x9003, value: opts.when }];
  if (opts.offset) entries.push({ tag: 0x9011, value: opts.offset });
  const ifd0At = 8;
  const exifAt = ifd0At + 2 + 12 + 4;
  let dataAt = exifAt + 2 + 12 * entries.length + 4;
  const size = dataAt + entries.reduce((n, e) => n + e.value.length + 1, 0);
  const tiff = new Uint8Array(size);
  const v = new DataView(tiff.buffer);
  const le = opts.little;
  tiff[0] = tiff[1] = le ? 0x49 : 0x4d;
  v.setUint16(2, 42, le);
  v.setUint32(4, ifd0At, le);
  v.setUint16(ifd0At, 1, le);
  v.setUint16(ifd0At + 2, 0x8769, le);
  v.setUint16(ifd0At + 4, 4, le);
  v.setUint32(ifd0At + 6, 1, le);
  v.setUint32(ifd0At + 10, exifAt, le);
  v.setUint16(exifAt, entries.length, le);
  entries.forEach((e, i) => {
    const at = exifAt + 2 + i * 12;
    v.setUint16(at, e.tag, le);
    v.setUint16(at + 2, 2, le);
    v.setUint32(at + 4, e.value.length + 1, le);
    v.setUint32(at + 8, dataAt, le);
    for (let j = 0; j < e.value.length; j += 1) tiff[dataAt + j] = e.value.charCodeAt(j);
    dataAt += e.value.length + 1;
  });
  const app1Length = 2 + 6 + tiff.length;
  const jfif = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0, 0, 1, 0, 1, 0, 0];
  return new Uint8Array([
    0xff, 0xd8,
    ...jfif,
    0xff, 0xe1, app1Length >> 8, app1Length & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0,
    ...tiff,
    0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9,
  ]);
}

