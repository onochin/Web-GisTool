import { resolveCrs } from "../crs/resolver";
import { geometryTypeLabel, outputFileName, transformDataset } from "./common";
import { readGeoJson, writeGeoJson } from "./geojson";
import { inspectGeoPackage, readGeoPackage, writeGeoPackage } from "./geopackage";
import { readKml, writeKml } from "./kml";
import { readShapefileZip, writeShapefileZip } from "./shapefile";
import type { VectorDataset, VectorFileAnalysis, VectorFormat, VectorOutput } from "./types";

export const MAX_VECTOR_FILE_SIZE = 100 * 1024 * 1024;

function startsWith(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

export function detectVectorFormat(fileName: string, header: Uint8Array, textStart: string): VectorFormat {
  if (startsWith(header, [0x50, 0x4b, 0x03, 0x04]) || startsWith(header, [0x50, 0x4b, 0x05, 0x06])) return "shapefile";
  const sqlite = new TextDecoder().decode(header.slice(0, 16)) === "SQLite format 3\0";
  const gpkgApplicationId = header.length >= 72 && new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(68, false) === 0x47504b47;
  if (sqlite && gpkgApplicationId) return "geopackage";
  if (sqlite) throw new Error("SQLiteファイルですがGeoPackageとして確認できません");
  const start = textStart.replace(/^\uFEFF/, "").trimStart();
  if (start.startsWith("{") || start.startsWith("[")) return "geojson";
  if (/^(?:<\?xml[^>]*>\s*)?<(?:[\w.-]+:)?kml[\s>]/i.test(start)) return "kml";
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "geojson" || extension === "json") return "geojson";
  if (extension === "kml") return "kml";
  throw new Error("対応していない形式、またはファイルを判定できません");
}

function summary(dataset: VectorDataset) {
  return {
    name: dataset.layerName,
    crs: dataset.crs,
    geometryType: geometryTypeLabel(dataset.geometryTypes),
    featureCount: dataset.features.length,
  };
}

export async function analyzeVectorFile(file: File): Promise<VectorFileAnalysis> {
  if (file.size === 0) throw new Error("空のファイルは解析できません");
  if (file.size > MAX_VECTOR_FILE_SIZE) throw new Error("ファイルサイズは100MB以下にしてください");
  const headerBuffer = await file.slice(0, 4096).arrayBuffer();
  const header = new Uint8Array(headerBuffer);
  const format = detectVectorFormat(file.name, header, new TextDecoder().decode(header));
  let layers;
  let warnings: string[] = [];
  if (format === "geopackage") {
    layers = await inspectGeoPackage(new Uint8Array(await file.arrayBuffer()));
  } else if (format === "shapefile") {
    const datasets = await readShapefileZip(new Uint8Array(await file.arrayBuffer()), file.name);
    layers = datasets.map(summary);
    warnings = datasets.flatMap((dataset) => dataset.warnings);
  } else {
    const text = await file.text();
    const dataset = format === "geojson" ? readGeoJson(text, file.name) : readKml(text, file.name);
    layers = [summary(dataset)];
    warnings = dataset.warnings;
  }
  return { kind: "vector", format, fileName: file.name, fileSize: file.size, layers, warnings };
}

export async function readVectorLayer(file: File, format: VectorFormat, layerName: string): Promise<VectorDataset> {
  if (format === "geopackage") return readGeoPackage(new Uint8Array(await file.arrayBuffer()), file.name, layerName);
  if (format === "shapefile") {
    const datasets = await readShapefileZip(new Uint8Array(await file.arrayBuffer()), file.name);
    const selected = datasets.find((dataset) => dataset.layerName === layerName);
    if (!selected) throw new Error(`ZIP内にレイヤー「${layerName}」がありません`);
    return selected;
  }
  const text = await file.text();
  return format === "geojson" ? readGeoJson(text, file.name) : readKml(text, file.name);
}

function validatedManualEpsg(value?: number | null): number | null {
  if (value === null || value === undefined) return null;
  resolveCrs(value);
  return value;
}

function hasPositionWithMoreThanThreeValues(dataset: VectorDataset): boolean {
  let found = false;
  const visit = (value: unknown) => {
    if (found || !Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") found = value.length > 3;
    else value.forEach(visit);
  };
  const visitGeometry = (geometry: NonNullable<VectorDataset["features"][number]["geometry"]>) => {
    if (geometry.type === "GeometryCollection") geometry.geometries.forEach(visitGeometry);
    else visit(geometry.coordinates);
  };
  dataset.features.forEach((feature) => {
    if (feature.geometry) visitGeometry(feature.geometry);
  });
  return found;
}

export async function convertVectorFile(
  file: File,
  analysis: VectorFileAnalysis,
  layerName: string,
  outputFormat: VectorFormat,
  options: { manualSourceEpsg?: number | null; outputLayerName?: string } = {},
): Promise<VectorOutput> {
  if (analysis.format === outputFormat) throw new Error("入力と同じ形式は出力に選択できません");
  const manualEpsg = validatedManualEpsg(options.manualSourceEpsg);
  const dataset = await readVectorLayer(file, analysis.format, layerName);
  const sourceEpsg = manualEpsg ?? dataset.crs.epsg ?? dataset.crs.equivalentEpsg;
  let bytes: Uint8Array;
  let warnings = [...dataset.warnings];

  if (outputFormat === "geojson" || outputFormat === "kml") {
    const wgs84 = transformDataset(dataset, 4326, manualEpsg);
    bytes = outputFormat === "geojson" ? writeGeoJson(wgs84) : writeKml(wgs84);
    if (outputFormat === "kml") {
      if (dataset.features.some((feature) => !feature.geometry)) warnings.push("GeometryがないFeatureはKML出力から除外しました。");
      if (hasPositionWithMoreThanThreeValues(dataset)) warnings.push("KMLではM値を保持できないため、座標の4番目以降の値を省略しました。");
      if (dataset.features.some((feature) => Object.values(feature.properties).some((value) => typeof value === "object" && value !== null))) {
        warnings.push("KMLでは配列・オブジェクト属性をJSON文字列として出力しました。");
      }
    }
  } else if (outputFormat === "shapefile") {
    const result = writeShapefileZip(dataset, sourceEpsg);
    bytes = result.bytes;
    warnings = result.warnings;
  } else {
    if (!sourceEpsg) throw new Error("GeoPackage出力には入力CRSのEPSG番号が必要です");
    const result = await writeGeoPackage(dataset, options.outputLayerName || dataset.layerName, sourceEpsg);
    bytes = result.bytes;
    warnings = result.warnings;
  }

  const mimeTypes: Record<VectorFormat, string> = {
    geojson: "application/geo+json", kml: "application/vnd.google-earth.kml+xml",
    shapefile: "application/zip", geopackage: "application/geopackage+sqlite3",
  };
  return { bytes, fileName: outputFileName(file.name, outputFormat), mimeType: mimeTypes[outputFormat], warnings };
}
