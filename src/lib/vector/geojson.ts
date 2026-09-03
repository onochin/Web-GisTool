import { parseGeoJson } from "../gis/vector";
import { assertGeometry, geometryTypes, safeBaseName } from "./common";
import type { VectorDataset, VectorFeature, VectorGeometry } from "./types";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFeature(value: unknown): VectorFeature {
  if (!isObject(value) || value.type !== "Feature") throw new Error("GeoJSONのFeatureが不正です");
  if (value.geometry !== null) assertGeometry(value.geometry);
  return {
    type: "Feature",
    ...(typeof value.id === "string" || typeof value.id === "number" ? { id: value.id } : {}),
    properties: isObject(value.properties) ? { ...value.properties } : {},
    geometry: value.geometry as VectorGeometry | null,
  };
}

export function readGeoJson(text: string, fileName: string): VectorDataset {
  const metadata = parseGeoJson(text, fileName, new TextEncoder().encode(text).byteLength);
  const root = JSON.parse(text) as unknown;
  if (!isObject(root)) throw new Error("GeoJSONのルート要素が不正です");
  let features: VectorFeature[];
  if (root.type === "FeatureCollection") {
    if (!Array.isArray(root.features)) throw new Error("GeoJSONのfeaturesが不正です");
    features = root.features.map(toFeature);
  } else if (root.type === "Feature") {
    features = [toFeature(root)];
  } else {
    assertGeometry(root);
    features = [{ type: "Feature", properties: {}, geometry: root }];
  }
  return {
    kind: "vector", format: "geojson", fileName, layerName: safeBaseName(fileName),
    crs: metadata.crs, features, geometryTypes: geometryTypes(features), warnings: [],
  };
}

export function writeGeoJson(dataset: VectorDataset): Uint8Array {
  const collection = { type: "FeatureCollection", features: dataset.features };
  return new TextEncoder().encode(JSON.stringify(collection, null, 2));
}

