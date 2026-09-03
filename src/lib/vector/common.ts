import { detectCrsMetadata } from "../crs/metadata";
import { resolveCrs } from "../crs/resolver";
import { transformInternalCoordinate } from "../coordinates/transform";
import type { VectorDataset, VectorFeature, VectorFormat, VectorGeometry } from "./types";

export const SUPPORTED_GEOMETRIES = new Set([
  "Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection",
]);

export function safeBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^\.+/, "") || "layer";
}

export function safeLayerName(name: string): string {
  return safeBaseName(name).slice(0, 63) || "layer";
}

export function geometryTypes(features: VectorFeature[]): string[] {
  return [...new Set(features.flatMap((feature) => feature.geometry ? [feature.geometry.type] : []))];
}

export function geometryTypeLabel(types: string[]): string {
  return types.length === 0 ? "なし" : types.length === 1 ? types[0] : "Mixed";
}

export function assertGeometry(value: unknown): asserts value is VectorGeometry {
  if (!value || typeof value !== "object") throw new Error("Geometryが不正です");
  const geometry = value as { type?: unknown; coordinates?: unknown; geometries?: unknown };
  if (typeof geometry.type !== "string" || !SUPPORTED_GEOMETRIES.has(geometry.type)) {
    throw new Error(`対応していないGeometryです: ${String(geometry.type ?? "不明")}`);
  }
  if (geometry.type === "GeometryCollection") {
    if (!Array.isArray(geometry.geometries)) throw new Error("GeometryCollectionのgeometriesが不正です");
    geometry.geometries.forEach(assertGeometry);
  } else if (!Array.isArray(geometry.coordinates)) {
    throw new Error(`${geometry.type}のcoordinatesが不正です`);
  }
}

function mapCoordinates(value: unknown, transform: (position: number[]) => number[]): unknown {
  if (!Array.isArray(value)) throw new Error("座標配列が不正です");
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    if (!Number.isFinite(value[0]) || !Number.isFinite(value[1])) throw new Error("有限値ではない座標があります");
    return transform(value);
  }
  return value.map((child) => mapCoordinates(child, transform));
}

function mapGeometry(geometry: VectorGeometry, transform: (position: number[]) => number[]): VectorGeometry {
  if (geometry.type === "GeometryCollection") {
    return { type: "GeometryCollection", geometries: geometry.geometries.map((child) => mapGeometry(child, transform)) };
  }
  return { ...geometry, coordinates: mapCoordinates(geometry.coordinates, transform) } as VectorGeometry;
}

export function effectiveEpsg(dataset: VectorDataset, manualEpsg?: number | null): number | null {
  return manualEpsg ?? dataset.crs.epsg ?? dataset.crs.equivalentEpsg;
}

export function transformDataset(dataset: VectorDataset, destinationEpsg: number, manualSourceEpsg?: number | null): VectorDataset {
  const sourceEpsg = effectiveEpsg(dataset, manualSourceEpsg);
  if (!sourceEpsg) throw new Error("入力CRSが不明です。EPSG番号を指定してください");
  const source = resolveCrs(sourceEpsg);
  const destination = resolveCrs(destinationEpsg);
  const transform = (position: number[]) => {
    const [x, y] = sourceEpsg === destinationEpsg
      ? [position[0], position[1]]
      : transformInternalCoordinate([position[0], position[1]], source, destination);
    return [x, y, ...position.slice(2)];
  };
  const features = dataset.features.map((feature) => ({
    ...feature,
    properties: { ...feature.properties },
    geometry: feature.geometry ? mapGeometry(feature.geometry, transform) : null,
  }));
  return {
    ...dataset,
    crs: detectCrsMetadata({ epsg: destinationEpsg, source: "ベクター変換", convention: destinationEpsg === 4326 ? "geojson" : undefined }),
    features,
    geometryTypes: geometryTypes(features),
  };
}

export function outputFileName(inputName: string, format: VectorFormat): string {
  const extension: Record<VectorFormat, string> = { geojson: "geojson", kml: "kml", shapefile: "zip", geopackage: "gpkg" };
  return `${safeBaseName(inputName)}_converted.${extension[format]}`;
}

