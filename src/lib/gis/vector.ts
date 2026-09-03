import { detectCrsMetadata } from "../crs/metadata";
import type { Bounds, CrsInfo, FieldInfo, GisMetadata } from "./types";

type JsonObject = Record<string, unknown>;

const geometryNames = new Set([
  "Point", "MultiPoint", "LineString", "MultiLineString",
  "Polygon", "MultiPolygon", "GeometryCollection",
]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferValueType(value: unknown): string {
  if (value === null || value === undefined) return "Unknown";
  if (typeof value === "number") return Number.isInteger(value) ? "Integer" : "Real";
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) ? "Date" : "String";
  if (typeof value === "boolean") return "Boolean";
  if (Array.isArray(value)) return "Array";
  if (typeof value === "object") return "Object";
  return "Unknown";
}

function collectFields(properties: unknown[], fields: Map<string, Set<string>>) {
  for (const propertiesValue of properties) {
    if (!isObject(propertiesValue)) continue;
    for (const [name, value] of Object.entries(propertiesValue)) {
      const types = fields.get(name) ?? new Set<string>();
      types.add(inferValueType(value));
      fields.set(name, types);
    }
  }
}

function formatFields(fields: Map<string, Set<string>>): FieldInfo[] {
  return [...fields].map(([name, types]) => {
    const known = [...types].filter((type) => type !== "Unknown");
    const numeric = known.every((type) => type === "Integer" || type === "Real");
    return { name, type: known.length > 1 && !numeric ? "Mixed" : known.includes("Real") ? "Real" : known[0] ?? "Unknown" };
  });
}

function updateBounds(bounds: Bounds | null, x: number, y: number): Bounds {
  if (!bounds) return { xmin: x, ymin: y, xmax: x, ymax: y };
  bounds.xmin = Math.min(bounds.xmin, x);
  bounds.ymin = Math.min(bounds.ymin, y);
  bounds.xmax = Math.max(bounds.xmax, x);
  bounds.ymax = Math.max(bounds.ymax, y);
  return bounds;
}

function inspectCoordinates(
  value: unknown,
  state: { bounds: Bounds | null; hasZ: boolean },
) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    if (Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      state.bounds = updateBounds(state.bounds, value[0], value[1]);
    }
    if (value.length >= 3 && typeof value[2] === "number") state.hasZ = true;
    return;
  }
  for (const child of value) inspectCoordinates(child, state);
}

function inspectGeometry(
  value: unknown,
  state: { bounds: Bounds | null; hasZ: boolean; types: Set<string> },
) {
  if (!isObject(value)) return;
  const type = typeof value.type === "string" ? value.type : "";
  if (!geometryNames.has(type)) throw new Error("GeoJSONのGeometry形式を解析できません");
  state.types.add(type);
  if (type === "GeometryCollection") {
    if (!Array.isArray(value.geometries)) throw new Error("GeometryCollectionが不正です");
    for (const geometry of value.geometries) inspectGeometry(geometry, state);
  } else {
    inspectCoordinates(value.coordinates, state);
  }
}

function geoJsonCrs(root: JsonObject): CrsInfo {
  const crs = root.crs;
  if (isObject(crs) && isObject(crs.properties) && typeof crs.properties.name === "string") {
    const name = crs.properties.name;
    return detectCrsMetadata({
      identifier: name,
      source: "GeoJSON crsプロパティ",
      convention: "geojson",
    });
  }
  return detectCrsMetadata({ convention: "geojson" });
}

export function parseGeoJson(text: string, fileName: string, fileSize: number): GisMetadata {
  let root: unknown;
  try { root = JSON.parse(text); }
  catch { throw new Error("GeoJSONを読み込めません。JSONの内容を確認してください"); }
  if (!isObject(root)) throw new Error("GeoJSONのルート要素が不正です");

  const state = { bounds: null as Bounds | null, hasZ: false, types: new Set<string>() };
  const properties: unknown[] = [];
  let featureCount = 0;

  if (root.type === "FeatureCollection") {
    if (!Array.isArray(root.features)) throw new Error("GeoJSONのfeaturesが不正です");
    featureCount = root.features.length;
    for (const feature of root.features) {
      if (!isObject(feature) || feature.type !== "Feature") throw new Error("GeoJSONのFeatureが不正です");
      if (feature.geometry !== null) inspectGeometry(feature.geometry, state);
      properties.push(feature.properties);
    }
  } else if (root.type === "Feature") {
    featureCount = 1;
    if (root.geometry !== null) inspectGeometry(root.geometry, state);
    properties.push(root.properties);
  } else if (typeof root.type === "string" && geometryNames.has(root.type)) {
    inspectGeometry(root, state);
  } else {
    throw new Error("対応しているGeoJSONデータではありません");
  }

  const fields = new Map<string, Set<string>>();
  collectFields(properties, fields);
  const geometryTypes = [...state.types];
  return {
    kind: "vector",
    format: "GeoJSON",
    fileName,
    fileSize,
    crs: geoJsonCrs(root),
    bounds: state.bounds,
    vector: {
      geometryType: geometryTypes.length === 0 ? "なし" : geometryTypes.length === 1 ? geometryTypes[0] : "Mixed",
      geometryTypes,
      featureCount,
      hasZ: state.hasZ,
      hasM: null,
      fields: formatFields(fields),
    },
  };
}

function elements(parent: ParentNode, name: string): Element[] {
  return [...parent.querySelectorAll(name)];
}

export function parseKml(text: string, fileName: string, fileSize: number): GisMetadata {
  if (typeof DOMParser === "undefined") throw new Error("この環境ではKMLを解析できません");
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror") || !document.documentElement.localName.toLowerCase().includes("kml")) {
    throw new Error("KMLを読み込めません。XMLの内容を確認してください");
  }
  const state = { bounds: null as Bounds | null, hasZ: false, types: new Set<string>() };
  const geometryMap: Record<string, string> = {
    Point: "Point", LineString: "LineString", Polygon: "Polygon", MultiGeometry: "GeometryCollection",
  };
  for (const [tag, type] of Object.entries(geometryMap)) {
    if (elements(document, tag).length > 0) state.types.add(type);
  }
  for (const coordinateElement of elements(document, "coordinates")) {
    for (const tuple of (coordinateElement.textContent ?? "").trim().split(/\s+/)) {
      if (!tuple) continue;
      const values = tuple.split(",").map(Number);
      if (values.length < 2 || !Number.isFinite(values[0]) || !Number.isFinite(values[1])) continue;
      state.bounds = updateBounds(state.bounds, values[0], values[1]);
      if (values.length >= 3 && Number.isFinite(values[2])) state.hasZ = true;
    }
  }
  const geometryTypes = [...state.types];
  const placemarks = elements(document, "Placemark");
  const fields: FieldInfo[] = [];
  if (placemarks.some((item) => item.querySelector("name"))) fields.push({ name: "name", type: "String" });
  if (placemarks.some((item) => item.querySelector("description"))) fields.push({ name: "description", type: "String" });
  return {
    kind: "vector", format: "KML", fileName, fileSize,
    crs: detectCrsMetadata({ convention: "kml" }),
    bounds: state.bounds,
    vector: {
      geometryType: geometryTypes.length === 0 ? "なし" : geometryTypes.length === 1 ? geometryTypes[0] : "Mixed",
      geometryTypes, featureCount: placemarks.length, hasZ: state.hasZ, hasM: null, fields,
    },
  };
}
