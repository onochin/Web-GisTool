import { fileSource, parseGeoTiff } from "./geotiff";
import type { GisFormat, GisMetadata } from "./types";
import { parseGeoJson, parseKml } from "./vector";

export function detectGisFormat(fileName: string, header: Uint8Array, textStart = ""): GisFormat {
  if (header.length >= 4) {
    const littleTiff = header[0] === 0x49 && header[1] === 0x49 && (header[2] === 42 || header[2] === 43) && header[3] === 0;
    const bigTiff = header[0] === 0x4d && header[1] === 0x4d && header[2] === 0 && (header[3] === 42 || header[3] === 43);
    if (littleTiff || bigTiff) return "GeoTIFF";
  }
  const start = textStart.replace(/^\uFEFF/, "").trimStart();
  if (start.startsWith("{") || start.startsWith("[")) return "GeoJSON";
  if (/^(?:<\?xml[^>]*>\s*)?<kml[\s>]/i.test(start)) return "KML";
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "geojson" || extension === "json") return "GeoJSON";
  if (extension === "kml") return "KML";
  throw new Error("このファイル形式には現在対応していません");
}

export async function analyzeGisFile(file: File): Promise<GisMetadata> {
  if (file.size === 0) throw new Error("空のファイルは解析できません");
  const headerBuffer = await file.slice(0, 4096).arrayBuffer();
  const header = new Uint8Array(headerBuffer);
  const textStart = new TextDecoder().decode(header);
  const format = detectGisFormat(file.name, header, textStart);
  if (format === "GeoTIFF") return parseGeoTiff(fileSource(file), file.name);
  const text = await file.text();
  return format === "GeoJSON" ? parseGeoJson(text, file.name, file.size) : parseKml(text, file.name, file.size);
}

