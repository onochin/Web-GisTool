import { detectCrsMetadata } from "../crs/metadata";
import type { Bounds, CrsInfo, GisMetadata } from "./types";

type ByteSource = { size: number; read(offset: number, length: number): Promise<ArrayBuffer> };
type Endian = boolean;
type IfdValue = number | string | number[];
type Ifd = Map<number, IfdValue>;

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const METADATA_TAGS = new Set([256, 257, 258, 259, 277, 330, 339, 33550, 33922, 34264, 34735, 34736, 34737, 42113]);
const compressionNames: Record<number, string> = {
  1: "None", 5: "LZW", 7: "JPEG", 8: "Deflate", 32946: "Deflate", 50000: "ZSTD", 50001: "WebP",
};
const sampleFormats: Record<number, string> = { 1: "Unsigned integer", 2: "Signed integer", 3: "Floating point", 4: "Undefined" };

function values(value: IfdValue | undefined): number[] {
  if (typeof value === "number") return [value];
  return Array.isArray(value) ? value : [];
}

function numberValue(ifd: Ifd, tag: number, fallback = 0): number {
  return values(ifd.get(tag))[0] ?? fallback;
}

async function readExact(source: ByteSource, offset: number, length: number): Promise<ArrayBuffer> {
  if (offset < 0 || length < 0 || offset + length > source.size) throw new Error("GeoTIFFのメタデータ位置が不正です");
  const buffer = await source.read(offset, length);
  if (buffer.byteLength !== length) throw new Error("GeoTIFFのメタデータが途中で切れています");
  return buffer;
}

function readTyped(view: DataView, offset: number, type: number, little: Endian): number {
  switch (type) {
    case 1: case 7: return view.getUint8(offset);
    case 3: return view.getUint16(offset, little);
    case 4: return view.getUint32(offset, little);
    case 5: return view.getUint32(offset, little) / view.getUint32(offset + 4, little);
    case 6: return view.getInt8(offset);
    case 8: return view.getInt16(offset, little);
    case 9: return view.getInt32(offset, little);
    case 10: return view.getInt32(offset, little) / view.getInt32(offset + 4, little);
    case 11: return view.getFloat32(offset, little);
    case 12: return view.getFloat64(offset, little);
    default: throw new Error(`未対応のTIFFフィールド型です: ${type}`);
  }
}

async function parseIfd(source: ByteSource, offset: number, little: Endian): Promise<{ ifd: Ifd; next: number }> {
  if (offset <= 0 || offset + 2 > source.size) throw new Error("GeoTIFFのIFD位置が不正です");
  const countView = new DataView(await readExact(source, offset, 2));
  const count = countView.getUint16(0, little);
  if (count > 4096) throw new Error("GeoTIFFのIFDエントリー数が不正です");
  const tableSize = count * 12 + 4;
  const table = new DataView(await readExact(source, offset + 2, tableSize));
  const ifd: Ifd = new Map();
  for (let index = 0; index < count; index += 1) {
    const entry = index * 12;
    const tag = table.getUint16(entry, little);
    const type = table.getUint16(entry + 2, little);
    const valueCount = table.getUint32(entry + 4, little);
    if (!METADATA_TAGS.has(tag)) continue;
    const itemSize = TYPE_SIZE[type];
    if (!itemSize || valueCount > 1_000_000) continue;
    const byteLength = itemSize * valueCount;
    if (byteLength > 8 * 1024 * 1024) continue;
    let valueBuffer: ArrayBuffer;
    if (byteLength <= 4) {
      valueBuffer = table.buffer.slice(table.byteOffset + entry + 8, table.byteOffset + entry + 12);
    } else {
      const valueOffset = table.getUint32(entry + 8, little);
      if (valueOffset + byteLength > source.size) continue;
      valueBuffer = await readExact(source, valueOffset, byteLength);
    }
    const valueView = new DataView(valueBuffer);
    if (type === 2) {
      const bytes = new Uint8Array(valueBuffer, 0, byteLength);
      ifd.set(tag, new TextDecoder().decode(bytes).replace(/\0+$/, ""));
    } else {
      const parsed = Array.from({ length: valueCount }, (_, item) => readTyped(valueView, item * itemSize, type, little));
      ifd.set(tag, parsed.length === 1 ? parsed[0] : parsed);
    }
  }
  return { ifd, next: table.getUint32(count * 12, little) };
}

function parseGeoKeys(ifd: Ifd): Map<number, number | string> {
  const directory = values(ifd.get(34735));
  const result = new Map<number, number | string>();
  if (directory.length < 4) return result;
  const doubles = values(ifd.get(34736));
  const ascii = typeof ifd.get(34737) === "string" ? ifd.get(34737) as string : "";
  for (let index = 0; index < directory[3]; index += 1) {
    const start = 4 + index * 4;
    const [key, location, count, offset] = directory.slice(start, start + 4);
    if (location === 0) result.set(key, offset);
    else if (location === 34736) result.set(key, count === 1 ? doubles[offset] : doubles.slice(offset, offset + count).join(", "));
    else if (location === 34737) result.set(key, ascii.slice(offset, offset + count).replace(/\|$/, ""));
  }
  return result;
}

function crsInfo(ifd: Ifd): CrsInfo {
  const keys = parseGeoKeys(ifd);
  const modelType = keys.get(1024);
  const epsgValue = modelType === 1 ? keys.get(3072) : keys.get(2048);
  const epsg = typeof epsgValue === "number" && epsgValue > 0 && epsgValue !== 32767 ? epsgValue : null;
  const citation = (modelType === 1 ? keys.get(3073) : keys.get(2049));
  const unitCode = modelType === 1 ? keys.get(3076) : keys.get(2054);
  return detectCrsMetadata({
    epsg,
    citation: typeof citation === "string" ? citation : null,
    unit: unitCode === 9001 ? "metre" : unitCode === 9102 ? "degree" : null,
    type: modelType === 1 ? "projected" : modelType === 2 ? "geographic" : null,
    dataAxisOrder: modelType === 1 ? "eastingNorthing" : modelType === 2 ? "longitudeLatitude" : null,
    source: keys.size > 0 ? "GeoTIFF GeoKey" : null,
  });
}

function rasterBounds(ifd: Ifd, width: number, height: number): { bounds: Bounds | null; resolution: readonly [number, number] | null } {
  const matrix = values(ifd.get(34264));
  if (matrix.length >= 16) {
    const points = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => [
      matrix[0] * x + matrix[1] * y + matrix[3],
      matrix[4] * x + matrix[5] * y + matrix[7],
    ]);
    return {
      bounds: {
        xmin: Math.min(...points.map((point) => point[0])), ymin: Math.min(...points.map((point) => point[1])),
        xmax: Math.max(...points.map((point) => point[0])), ymax: Math.max(...points.map((point) => point[1])),
      },
      resolution: [Math.hypot(matrix[0], matrix[4]), Math.hypot(matrix[1], matrix[5])],
    };
  }
  const scale = values(ifd.get(33550));
  const tie = values(ifd.get(33922));
  if (scale.length >= 2 && tie.length >= 6) {
    const originX = tie[3] - tie[0] * scale[0];
    const originY = tie[4] + tie[1] * scale[1];
    const otherX = originX + width * scale[0];
    const otherY = originY - height * scale[1];
    return {
      bounds: { xmin: Math.min(originX, otherX), ymin: Math.min(originY, otherY), xmax: Math.max(originX, otherX), ymax: Math.max(originY, otherY) },
      resolution: [Math.abs(scale[0]), Math.abs(scale[1])],
    };
  }
  return { bounds: null, resolution: null };
}

export async function parseGeoTiff(source: ByteSource, fileName: string): Promise<GisMetadata> {
  if (source.size < 8) throw new Error("GeoTIFFファイルが空か、壊れています");
  const header = new DataView(await readExact(source, 0, 8));
  const marker = String.fromCharCode(header.getUint8(0), header.getUint8(1));
  if (marker !== "II" && marker !== "MM") throw new Error("TIFFのバイトオーダーを確認できません");
  const little = marker === "II";
  const magic = header.getUint16(2, little);
  if (magic === 43) throw new Error("BigTIFFには現在対応していません");
  if (magic !== 42) throw new Error("有効なTIFFファイルではありません");
  const { ifd, next } = await parseIfd(source, header.getUint32(4, little), little);
  const width = numberValue(ifd, 256);
  const height = numberValue(ifd, 257);
  if (!width || !height) throw new Error("GeoTIFFの画像サイズを取得できません");
  const bits = values(ifd.get(258));
  const sampleFormat = values(ifd.get(339))[0] ?? 1;
  const uniqueBits = [...new Set(bits.length ? bits : [8])];
  const { bounds, resolution } = rasterBounds(ifd, width, height);
  const compression = numberValue(ifd, 259, 1);
  const subIfds = values(ifd.get(330));
  return {
    kind: "raster", format: "GeoTIFF", fileName, fileSize: source.size,
    crs: crsInfo(ifd), bounds,
    raster: {
      width, height, bands: numberValue(ifd, 277, bits.length || 1), resolution,
      dataType: `${sampleFormats[sampleFormat] ?? `SampleFormat ${sampleFormat}`} ${uniqueBits.join("/")} bit`,
      noData: typeof ifd.get(42113) === "string" ? ifd.get(42113) as string : null,
      compression: compressionNames[compression] ?? `Code ${compression}`,
      hasOverviews: next > 0 || subIfds.length > 0,
    },
  };
}

export function arrayBufferSource(buffer: ArrayBuffer): ByteSource {
  return {
    size: buffer.byteLength,
    async read(offset, length) { return buffer.slice(offset, offset + length); },
  };
}

export function fileSource(file: File): ByteSource {
  return {
    size: file.size,
    read(offset, length) { return file.slice(offset, offset + length).arrayBuffer(); },
  };
}
