import { strToU8, unzipSync, zipSync } from "fflate";
import { CRS_BY_CODE } from "../crs/definitions";
import { detectCrsMetadata, unknownCrs } from "../crs/metadata";
import { geometryTypes, safeBaseName } from "./common";
import { epsgFromWkt, wktForEpsg } from "./crsWkt";
import type { Position, VectorDataset, VectorFeature, VectorGeometry } from "./types";

type ZipLayer = { name: string; shp?: Uint8Array; shx?: Uint8Array; dbf?: Uint8Array; prj?: Uint8Array; cpg?: Uint8Array };

function zipLayers(bytes: Uint8Array): ZipLayer[] {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); }
  catch { throw new Error("ZIPを展開できません。ファイルが壊れている可能性があります"); }
  const totalSize = Object.values(files).reduce((sum, file) => sum + file.byteLength, 0);
  if (totalSize > 250 * 1024 * 1024) throw new Error("展開後のShapefileは250MB以下にしてください");
  const layers = new Map<string, ZipLayer>();
  for (const [path, content] of Object.entries(files)) {
    if (path.includes("__MACOSX/") || path.endsWith("/")) continue;
    const match = path.match(/^(.*)\.(shp|shx|dbf|prj|cpg)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const layer = layers.get(key) ?? { name: match[1].split("/").pop() || "layer" };
    layer[match[2].toLowerCase() as keyof Omit<ZipLayer, "name">] = content;
    layers.set(key, layer);
  }
  const found = [...layers.values()].filter((layer) => layer.shp);
  if (!found.length) throw new Error("ZIP内にShapefile（.shp）がありません");
  for (const layer of found) {
    const missing = [!layer.shx && ".shx", !layer.dbf && ".dbf"].filter(Boolean);
    if (missing.length) throw new Error(`${layer.name}: ZIP内に${missing.join(" / ")}がありません`);
  }
  return found;
}

function shapefileCrs(prj?: Uint8Array) {
  if (!prj) return unknownCrs("xy");
  const wkt = new TextDecoder().decode(prj).replace(/\0+$/, "");
  const epsg = epsgFromWkt(wkt);
  if (!epsg) return { ...unknownCrs("xy"), source: "Shapefile .prj（EPSGを判定できません）" };
  const known = CRS_BY_CODE.get(`EPSG:${epsg}`);
  return detectCrsMetadata({
    epsg, source: "Shapefile .prj",
    dataAxisOrder: known?.type === "geographic" ? "longitudeLatitude" : "eastingNorthing",
  });
}

export async function readShapefileZip(bytes: Uint8Array, fileName: string): Promise<VectorDataset[]> {
  const { parseShp, parseDbf } = await import("shpjs");
  return zipLayers(bytes).map((layer) => {
    let geometries: unknown[];
    let properties: Record<string, unknown>[];
    try {
      geometries = parseShp(layer.shp!);
      properties = parseDbf(layer.dbf!, layer.cpg ? new TextDecoder().decode(layer.cpg).trim() : undefined);
    } catch (error) {
      throw new Error(`${layer.name}: Shapefileを解析できません（${error instanceof Error ? error.message : String(error)}）`);
    }
    const features: VectorFeature[] = geometries.map((geometry, index) => ({
      type: "Feature", properties: properties[index] ?? {}, geometry: geometry as VectorGeometry | null,
    }));
    return {
      kind: "vector", format: "shapefile", fileName, layerName: layer.name,
      crs: shapefileCrs(layer.prj), features, geometryTypes: geometryTypes(features),
      warnings: layer.prj ? [] : [".prjがないためCRSは不明です。"],
    };
  });
}

type ShapeCategory = "point" | "multipoint" | "line" | "polygon";
type ShapeRecord = { content: Uint8Array; bounds: number[]; zBounds: number[] | null };

function allPositions(geometry: VectorGeometry): Position[] {
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(allPositions);
  const result: Position[] = [];
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") result.push(value as Position);
    else value.forEach(visit);
  };
  visit(geometry.coordinates);
  return result;
}

function categoryForGeometry(geometry: VectorGeometry): ShapeCategory {
  if (geometry.type === "Point") return "point";
  if (geometry.type === "MultiPoint") return "multipoint";
  if (geometry.type === "LineString" || geometry.type === "MultiLineString") return "line";
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") return "polygon";
  throw new Error("ShapefileはGeometryCollectionを保持できません");
}

function boundsForPositions(points: Position[]): number[] {
  if (!points.length) return [0, 0, 0, 0];
  return [
    Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1])),
    Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1])),
  ];
}

function zBoundsForPositions(points: Position[]): number[] {
  const values = points.map((point) => point[2] ?? 0);
  return [Math.min(...values), Math.max(...values)];
}

function signedArea(ring: Position[]): number {
  return ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function orientRing(ring: Position[], clockwise: boolean): Position[] {
  const isClockwise = signedArea(ring) < 0;
  return isClockwise === clockwise ? ring : [...ring].reverse();
}

function geometryParts(geometry: VectorGeometry, category: ShapeCategory): Position[][] {
  if (category === "point") return [[(geometry as Extract<VectorGeometry, { type: "Point" }>).coordinates]];
  if (category === "multipoint") {
    return [(geometry.type === "Point" ? [geometry.coordinates] : (geometry as { coordinates: Position[] }).coordinates)];
  }
  if (category === "line") return geometry.type === "LineString" ? [geometry.coordinates] : (geometry as { coordinates: Position[][] }).coordinates;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : (geometry as Extract<VectorGeometry, { type: "MultiPolygon" }>).coordinates;
  return polygons.flatMap((polygon) => polygon.map((ring, index) => orientRing(ring, index === 0)));
}

function writeShapeRecord(geometry: VectorGeometry | null, category: ShapeCategory, hasZ: boolean, shapeType: number): ShapeRecord {
  if (!geometry) {
    const content = new Uint8Array(4);
    return { content, bounds: [0, 0, 0, 0], zBounds: null };
  }
  const parts = geometryParts(geometry, category);
  const points = parts.flat();
  const bounds = boundsForPositions(points);
  const zBounds = hasZ ? zBoundsForPositions(points) : null;
  let size: number;
  if (category === "point") size = hasZ ? 36 : 20;
  else if (category === "multipoint") size = 40 + points.length * 16 + (hasZ ? 32 + points.length * 16 : 0);
  else size = 44 + parts.length * 4 + points.length * 16 + (hasZ ? 32 + points.length * 16 : 0);
  const content = new Uint8Array(size);
  const view = new DataView(content.buffer);
  view.setInt32(0, shapeType, true);
  if (category === "point") {
    view.setFloat64(4, points[0][0], true); view.setFloat64(12, points[0][1], true);
    if (hasZ) { view.setFloat64(20, points[0][2] ?? 0, true); view.setFloat64(28, -1e39, true); }
    return { content, bounds, zBounds };
  }
  bounds.forEach((value, index) => view.setFloat64(4 + index * 8, value, true));
  let offset = 36;
  if (category === "multipoint") {
    view.setInt32(offset, points.length, true); offset += 4;
  } else {
    view.setInt32(offset, parts.length, true); view.setInt32(offset + 4, points.length, true); offset += 8;
    let pointIndex = 0;
    for (const part of parts) { view.setInt32(offset, pointIndex, true); offset += 4; pointIndex += part.length; }
  }
  for (const point of points) { view.setFloat64(offset, point[0], true); view.setFloat64(offset + 8, point[1], true); offset += 16; }
  if (hasZ && zBounds) {
    view.setFloat64(offset, zBounds[0], true); view.setFloat64(offset + 8, zBounds[1], true); offset += 16;
    for (const point of points) { view.setFloat64(offset, point[2] ?? 0, true); offset += 8; }
    view.setFloat64(offset, -1e39, true); view.setFloat64(offset + 8, -1e39, true); offset += 16;
    for (let index = 0; index < points.length; index += 1) { view.setFloat64(offset, -1e39, true); offset += 8; }
  }
  return { content, bounds, zBounds };
}

function shapeHeader(fileLengthBytes: number, shapeType: number, bounds: number[], zBounds: number[]): Uint8Array {
  const header = new Uint8Array(100);
  const view = new DataView(header.buffer);
  view.setInt32(0, 9994, false);
  view.setInt32(24, fileLengthBytes / 2, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, shapeType, true);
  bounds.forEach((value, index) => view.setFloat64(36 + index * 8, value, true));
  view.setFloat64(68, zBounds[0], true); view.setFloat64(76, zBounds[1], true);
  view.setFloat64(84, -1e39, true); view.setFloat64(92, -1e39, true);
  return header;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function encodeShapes(features: VectorFeature[]): { shp: Uint8Array; shx: Uint8Array } {
  const geometries = features.flatMap((feature) => feature.geometry ? [feature.geometry] : []);
  if (!geometries.length) throw new Error("Shapefileへ出力できるGeometryがありません");
  if (geometries.some((geometry) => allPositions(geometry).some((point) => point.length >= 4))) throw new Error("Shapefile出力ではM値を保持できません");
  const categories = new Set(geometries.map(categoryForGeometry));
  if (categories.has("point") && categories.has("multipoint")) { categories.delete("point"); }
  if (categories.size !== 1) throw new Error("Shapefileは異なるGeometry種別を1レイヤーに保持できません");
  const category = [...categories][0];
  const hasZ = geometries.some((geometry) => allPositions(geometry).some((point) => point.length >= 3));
  const baseType = { point: 1, line: 3, polygon: 5, multipoint: 8 }[category];
  const shapeType = hasZ ? { 1: 11, 3: 13, 5: 15, 8: 18 }[baseType]! : baseType;
  const records = features.map((feature) => writeShapeRecord(feature.geometry, category, hasZ, shapeType));
  const nonNullBounds = records.filter((record) => record.content.length > 4).map((record) => record.bounds);
  const bounds = nonNullBounds.length ? [
    Math.min(...nonNullBounds.map((item) => item[0])), Math.min(...nonNullBounds.map((item) => item[1])),
    Math.max(...nonNullBounds.map((item) => item[2])), Math.max(...nonNullBounds.map((item) => item[3])),
  ] : [0, 0, 0, 0];
  const zRanges = records.flatMap((record) => record.zBounds ? [record.zBounds] : []);
  const zBounds = zRanges.length ? [Math.min(...zRanges.map((item) => item[0])), Math.max(...zRanges.map((item) => item[1]))] : [0, 0];
  const shpParts: Uint8Array[] = [];
  const shxEntries = new Uint8Array(records.length * 8);
  const shxView = new DataView(shxEntries.buffer);
  let shpLength = 100;
  records.forEach((record, index) => {
    const recordHeader = new Uint8Array(8);
    const view = new DataView(recordHeader.buffer);
    view.setInt32(0, index + 1, false); view.setInt32(4, record.content.length / 2, false);
    shxView.setInt32(index * 8, shpLength / 2, false); shxView.setInt32(index * 8 + 4, record.content.length / 2, false);
    shpParts.push(recordHeader, record.content);
    shpLength += recordHeader.length + record.content.length;
  });
  return {
    shp: concat([shapeHeader(shpLength, shapeType, bounds, zBounds), ...shpParts]),
    shx: concat([shapeHeader(100 + shxEntries.length, shapeType, bounds, zBounds), shxEntries]),
  };
}

type DbfField = { source: string; name: string; type: "C" | "N" | "L" | "D"; length: number; decimals: number };

function dbfFields(features: VectorFeature[], warnings: string[]): DbfField[] {
  const names = [...new Set(features.flatMap((feature) => Object.keys(feature.properties)))];
  const used = new Set<string>();
  return names.map((source, index) => {
    let name = /^[\x20-\x7e]+$/.test(source) ? source.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 10) : `FIELD_${index + 1}`;
    if (!name) name = `FIELD_${index + 1}`;
    const original = name;
    let suffix = 1;
    while (used.has(name.toUpperCase())) name = `${original.slice(0, 8)}${suffix++}`;
    used.add(name.toUpperCase());
    if (name !== source) warnings.push(`Shapefileの制約により属性名「${source}」を「${name}」へ変更しました。`);
    const values = features.map((feature) => feature.properties[source]).filter((value) => value !== null && value !== undefined);
    if (values.length && values.every((value) => typeof value === "boolean")) return { source, name, type: "L", length: 1, decimals: 0 };
    if (values.length && values.every((value) => typeof value === "number" && Number.isInteger(value))) return { source, name, type: "N", length: 18, decimals: 0 };
    if (values.length && values.every((value) => typeof value === "number")) return { source, name, type: "N", length: 24, decimals: 8 };
    if (values.length && values.every((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value))) return { source, name, type: "D", length: 8, decimals: 0 };
    const textValues = values.map((value) => typeof value === "object" ? JSON.stringify(value) : String(value));
    const length = Math.min(254, Math.max(1, ...textValues.map((value) => new TextEncoder().encode(value).length)));
    if (values.some((value) => typeof value === "object")) warnings.push(`属性「${source}」の配列・オブジェクト値はJSON文字列に変換しました。`);
    return { source, name, type: "C", length, decimals: 0 };
  });
}

function fitUtf8(text: string, length: number): Uint8Array {
  let value = text;
  while (new TextEncoder().encode(value).length > length) value = value.slice(0, -1);
  const output = new Uint8Array(length).fill(0x20);
  output.set(new TextEncoder().encode(value));
  return output;
}

function encodeDbf(features: VectorFeature[], warnings: string[]): Uint8Array {
  const fields = dbfFields(features, warnings);
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, field) => sum + field.length, 0);
  const output = new Uint8Array(headerLength + recordLength * features.length + 1).fill(0);
  const view = new DataView(output.buffer);
  const now = new Date();
  output[0] = 0x03; output[1] = now.getFullYear() - 1900; output[2] = now.getMonth() + 1; output[3] = now.getDate();
  view.setUint32(4, features.length, true); view.setUint16(8, headerLength, true); view.setUint16(10, recordLength, true);
  fields.forEach((field, index) => {
    const offset = 32 + index * 32;
    output.set(new TextEncoder().encode(field.name).slice(0, 10), offset);
    output[offset + 11] = field.type.charCodeAt(0); output[offset + 16] = field.length; output[offset + 17] = field.decimals;
  });
  output[headerLength - 1] = 0x0d;
  features.forEach((feature, row) => {
    let offset = headerLength + row * recordLength;
    output[offset++] = 0x20;
    for (const field of fields) {
      const value = feature.properties[field.source];
      let bytes: Uint8Array;
      if (value === null || value === undefined) bytes = new Uint8Array(field.length).fill(0x20);
      else if (field.type === "L") bytes = fitUtf8(value ? "T" : "F", field.length);
      else if (field.type === "D") bytes = fitUtf8(String(value).slice(0, 10).replace(/-/g, ""), field.length);
      else if (field.type === "N") {
        const numeric = field.decimals ? Number(value).toFixed(field.decimals).replace(/0+$/, "").replace(/\.$/, "") : String(value);
        bytes = fitUtf8(numeric.padStart(field.length), field.length);
      } else bytes = fitUtf8(typeof value === "object" ? JSON.stringify(value) : String(value), field.length);
      output.set(bytes, offset); offset += field.length;
    }
  });
  output[output.length - 1] = 0x1a;
  return output;
}

export function writeShapefileZip(dataset: VectorDataset, epsg: number | null): { bytes: Uint8Array; warnings: string[] } {
  const warnings = [...dataset.warnings];
  const { shp, shx } = encodeShapes(dataset.features);
  const dbf = encodeDbf(dataset.features, warnings);
  const name = safeBaseName(dataset.layerName);
  const files: Record<string, Uint8Array> = {
    [`${name}.shp`]: shp, [`${name}.shx`]: shx, [`${name}.dbf`]: dbf, [`${name}.cpg`]: strToU8("UTF-8"),
  };
  const wkt = epsg ? wktForEpsg(epsg) : null;
  if (wkt) files[`${name}.prj`] = strToU8(wkt);
  else warnings.push("CRSを特定できないため.prjは生成していません。");
  return { bytes: zipSync(files, { level: 6 }), warnings };
}
