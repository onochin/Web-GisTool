import { detectCrsMetadata } from "../crs/metadata";
import { assertGeometry, geometryTypes, safeBaseName } from "./common";
import type { VectorDataset, VectorFeature, VectorGeometry } from "./types";

function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function escapeXml(value: unknown): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

function propertyText(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

function tagContent(text: string, tag: string): string | null {
  const match = text.match(new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : null;
}

function blocks(text: string, tag: string): string[] {
  return [...text.matchAll(new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`, "gi"))].map((match) => match[1]);
}

function positions(text: string): number[][] {
  return text.trim().split(/\s+/).filter(Boolean).map((tuple) => {
    const values = tuple.split(",").map(Number);
    if (values.length < 2 || !Number.isFinite(values[0]) || !Number.isFinite(values[1])) throw new Error("KMLに不正な座標があります");
    return values;
  });
}

function parseGeometry(text: string): VectorGeometry {
  const multi = tagContent(text, "MultiGeometry");
  if (multi !== null) {
    const geometries: VectorGeometry[] = [];
    for (const tag of ["Point", "LineString", "Polygon"]) {
      for (const block of blocks(multi, tag)) geometries.push(parseGeometry(`<${tag}>${block}</${tag}>`));
    }
    if (!geometries.length) throw new Error("KMLのMultiGeometryが空です");
    return { type: "GeometryCollection", geometries };
  }
  const point = tagContent(text, "Point");
  if (point !== null) {
    const coordinateText = tagContent(point, "coordinates");
    if (!coordinateText) throw new Error("KMLのPointにcoordinatesがありません");
    return { type: "Point", coordinates: positions(coordinateText)[0] };
  }
  const line = tagContent(text, "LineString");
  if (line !== null) {
    const coordinateText = tagContent(line, "coordinates");
    if (!coordinateText) throw new Error("KMLのLineStringにcoordinatesがありません");
    return { type: "LineString", coordinates: positions(coordinateText) };
  }
  const polygon = tagContent(text, "Polygon");
  if (polygon !== null) {
    const outerBlock = tagContent(polygon, "outerBoundaryIs");
    const outerCoordinates = outerBlock ? tagContent(outerBlock, "coordinates") : null;
    if (!outerCoordinates) throw new Error("KMLのPolygonに外周座標がありません");
    const rings = [positions(outerCoordinates)];
    for (const inner of blocks(polygon, "innerBoundaryIs")) {
      const innerCoordinates = tagContent(inner, "coordinates");
      if (innerCoordinates) rings.push(positions(innerCoordinates));
    }
    return { type: "Polygon", coordinates: rings };
  }
  throw new Error("KMLのPlacemarkに対応するGeometryがありません");
}

export function readKml(text: string, fileName: string): VectorDataset {
  if (!/<(?:[\w.-]+:)?kml\b/i.test(text)) throw new Error("KMLとして読み取れません");
  const features = blocks(text, "Placemark").map((placemark): VectorFeature => {
    const properties: Record<string, unknown> = {};
    const name = tagContent(placemark, "name");
    const description = tagContent(placemark, "description");
    if (name !== null) properties.name = name;
    if (description !== null) properties.description = description;
    for (const match of placemark.matchAll(/<(?:[\w.-]+:)?(?:Data|SimpleData)\b[^>]*\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?(?:Data|SimpleData)>/gi)) {
      properties[decodeXml(match[1])] = decodeXml(tagContent(match[2], "value") ?? match[2].replace(/<[^>]+>/g, "").trim());
    }
    return { type: "Feature", properties, geometry: parseGeometry(placemark) };
  });
  if (!features.length) throw new Error("KMLにPlacemarkがありません");
  return {
    kind: "vector", format: "kml", fileName, layerName: safeBaseName(fileName),
    crs: detectCrsMetadata({ convention: "kml" }), features,
    geometryTypes: geometryTypes(features), warnings: [],
  };
}

function coordinateText(position: number[]): string {
  return position.slice(0, 3).join(",");
}

function writeGeometry(geometry: VectorGeometry): string {
  assertGeometry(geometry);
  switch (geometry.type) {
    case "Point": return `<Point><coordinates>${coordinateText(geometry.coordinates)}</coordinates></Point>`;
    case "LineString": return `<LineString><coordinates>${geometry.coordinates.map(coordinateText).join(" ")}</coordinates></LineString>`;
    case "Polygon": return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${geometry.coordinates[0].map(coordinateText).join(" ")}</coordinates></LinearRing></outerBoundaryIs>${geometry.coordinates.slice(1).map((ring) => `<innerBoundaryIs><LinearRing><coordinates>${ring.map(coordinateText).join(" ")}</coordinates></LinearRing></innerBoundaryIs>`).join("")}</Polygon>`;
    case "MultiPoint": return `<MultiGeometry>${geometry.coordinates.map((point) => writeGeometry({ type: "Point", coordinates: point })).join("")}</MultiGeometry>`;
    case "MultiLineString": return `<MultiGeometry>${geometry.coordinates.map((line) => writeGeometry({ type: "LineString", coordinates: line })).join("")}</MultiGeometry>`;
    case "MultiPolygon": return `<MultiGeometry>${geometry.coordinates.map((polygon) => writeGeometry({ type: "Polygon", coordinates: polygon })).join("")}</MultiGeometry>`;
    case "GeometryCollection": return `<MultiGeometry>${geometry.geometries.map(writeGeometry).join("")}</MultiGeometry>`;
  }
}

export function writeKml(dataset: VectorDataset): Uint8Array {
  const placemarks = dataset.features.map((feature) => {
    if (!feature.geometry) return "";
    const { name, description, ...extended } = feature.properties;
    const extendedData = Object.keys(extended).length ? `<ExtendedData>${Object.entries(extended).map(([key, value]) => `<Data name="${escapeXml(key)}"><value>${value === null ? "" : escapeXml(propertyText(value))}</value></Data>`).join("")}</ExtendedData>` : "";
    return `<Placemark>${name == null ? "" : `<name>${escapeXml(name)}</name>`}${description == null ? "" : `<description>${escapeXml(description)}</description>`}${extendedData}${writeGeometry(feature.geometry)}</Placemark>`;
  }).join("");
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(dataset.layerName)}</name>${placemarks}</Document></kml>`);
}
