import type { CrsDefinition } from "../crs/types";
import { transformCoordinate, transformInternalCoordinate } from "../coordinates/transform";

export type CoordinateFileFormat = "geojson" | "kml" | "csv";

export type ConvertedFile = {
  content: string;
  fileName: string;
  mimeType: string;
  format: CoordinateFileFormat;
  pointCount: number;
};

const MIME_TYPES: Record<CoordinateFileFormat, string> = {
  geojson: "application/geo+json",
  kml: "application/vnd.google-earth.kml+xml",
  csv: "text/csv;charset=utf-8",
};

export function detectCoordinateFileFormat(fileName: string): CoordinateFileFormat {
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "geojson" || extension === "json") return "geojson";
  if (extension === "kml") return "kml";
  if (extension === "csv" || extension === "tsv" || extension === "txt") return "csv";
  throw new Error("対応形式は GeoJSON（.geojson/.json）、KML（.kml）、CSV/TSV（.csv/.tsv/.txt）です");
}

function outputFileName(inputName: string, format: CoordinateFileFormat): string {
  const base = inputName.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}._-]+/gu, "_") || "coordinates";
  return `${base}_converted.${format}`;
}

function transformPosition(position: unknown[], source: CrsDefinition, destination: CrsDefinition): void {
  if (position.length < 2 || typeof position[0] !== "number" || typeof position[1] !== "number"
    || !Number.isFinite(position[0]) || !Number.isFinite(position[1])) {
    throw new Error("GeoJSONに有限値ではない座標があります");
  }
  const transformed = transformInternalCoordinate([Number(position[0]), Number(position[1])], source, destination);
  position[0] = transformed[0];
  position[1] = transformed[1];
}

function transformNestedCoordinates(
  coordinates: unknown,
  depth: number,
  source: CrsDefinition,
  destination: CrsDefinition,
): number {
  if (!Array.isArray(coordinates)) throw new Error("GeoJSONのcoordinatesが配列ではありません");
  if (depth === 0) {
    transformPosition(coordinates, source, destination);
    return 1;
  }
  return coordinates.reduce<number>((count, child) =>
    count + transformNestedCoordinates(child, depth - 1, source, destination), 0);
}

function transformGeometry(geometry: unknown, source: CrsDefinition, destination: CrsDefinition): number {
  if (geometry === null) return 0;
  if (!geometry || typeof geometry !== "object") throw new Error("GeoJSONのgeometryが不正です");
  const value = geometry as { type?: string; coordinates?: unknown; geometries?: unknown[] };
  const depths: Record<string, number> = {
    Point: 0,
    MultiPoint: 1,
    LineString: 1,
    MultiLineString: 2,
    Polygon: 2,
    MultiPolygon: 3,
  };
  if (value.type === "GeometryCollection") {
    if (!Array.isArray(value.geometries)) throw new Error("GeometryCollectionのgeometriesが不正です");
    return (value.geometries as unknown[]).reduce<number>(
      (count, child) => count + transformGeometry(child, source, destination),
      0,
    );
  }
  const depth = value.type ? depths[value.type] : undefined;
  if (depth === undefined) throw new Error(`未対応のGeoJSON geometryです: ${value.type ?? "不明"}`);
  return transformNestedCoordinates(value.coordinates, depth, source, destination);
}

export function convertGeoJson(text: string, source: CrsDefinition, destination: CrsDefinition): { content: string; pointCount: number } {
  let root: unknown;
  try { root = JSON.parse(text); }
  catch { throw new Error("GeoJSONをJSONとして読み取れませんでした"); }
  if (!root || typeof root !== "object") throw new Error("GeoJSONのルートが不正です");
  const geojson = root as { type?: string; features?: unknown[]; geometry?: unknown; crs?: unknown };
  let pointCount = 0;
  if (geojson.type === "FeatureCollection") {
    if (!Array.isArray(geojson.features)) throw new Error("FeatureCollectionのfeaturesが不正です");
    for (const feature of geojson.features) {
      if (!feature || typeof feature !== "object") throw new Error("不正なFeatureがあります");
      pointCount += transformGeometry((feature as { geometry?: unknown }).geometry, source, destination);
    }
  } else if (geojson.type === "Feature") {
    pointCount = transformGeometry(geojson.geometry, source, destination);
  } else {
    pointCount = transformGeometry(geojson, source, destination);
  }
  if (destination.code === "EPSG:4326") delete geojson.crs;
  else geojson.crs = { type: "name", properties: { name: destination.code } };
  return { content: JSON.stringify(geojson, null, 2), pointCount };
}

export function convertDelimitedText(text: string, source: CrsDefinition, destination: CrsDefinition): { content: string; pointCount: number } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const firstDataLine = lines.find((line) => line.trim() !== "");
  if (!firstDataLine) throw new Error("CSV/TSVが空です");
  const delimiter = firstDataLine.includes("\t") ? "\t" : ",";
  let pointCount = 0;
  let dataStarted = false;
  const converted = lines.map((line, index) => {
    if (!line.trim()) return line;
    const columns = line.split(delimiter);
    if (columns.length < 2) throw new Error(`${index + 1}行目: 座標列が2列ありません`);
    const firstText = columns[0].trim();
    const secondText = columns[1].trim();
    const first = firstText === "" ? Number.NaN : Number(firstText);
    const second = secondText === "" ? Number.NaN : Number(secondText);
    if (!Number.isFinite(first) || !Number.isFinite(second)) {
      if (!dataStarted) return line;
      throw new Error(`${index + 1}行目: 先頭2列に有限の数値を指定してください`);
    }
    dataStarted = true;
    const result = transformCoordinate([first, second], source, destination);
    columns[0] = String(result[0]);
    columns[1] = String(result[1]);
    pointCount += 1;
    return columns.join(delimiter);
  });
  if (!pointCount) throw new Error("変換できる座標行がありません");
  return { content: converted.join("\n"), pointCount };
}

function parseKmlPositions(text: string): number[][] {
  return text.trim().split(/\s+/).filter(Boolean).map((tuple) => {
    const values = tuple.split(",").map(Number);
    if (values.length < 2 || !Number.isFinite(values[0]) || !Number.isFinite(values[1])) {
      throw new Error("KMLに不正な座標があります");
    }
    return values;
  });
}

function firstDescendant(element: Element, localName: string): Element | undefined {
  return Array.from(element.getElementsByTagNameNS("*", localName))[0];
}

function kmlGeometryToGeoJson(element: Element): unknown {
  if (element.localName === "Point" || element.localName === "LineString" || element.localName === "LinearRing") {
    const coordinates = firstDescendant(element, "coordinates")?.textContent;
    if (!coordinates) throw new Error(`KMLの${element.localName}にcoordinatesがありません`);
    const positions = parseKmlPositions(coordinates);
    return element.localName === "Point"
      ? { type: "Point", coordinates: positions[0] }
      : { type: "LineString", coordinates: positions };
  }
  if (element.localName === "Polygon") {
    const outer = firstDescendant(element, "outerBoundaryIs");
    if (!outer) throw new Error("KMLのPolygonにouterBoundaryIsがありません");
    const outerCoordinates = firstDescendant(outer, "coordinates")?.textContent;
    if (!outerCoordinates) throw new Error("KMLのPolygonに外周座標がありません");
    const rings = [parseKmlPositions(outerCoordinates)];
    for (const inner of Array.from(element.getElementsByTagNameNS("*", "innerBoundaryIs"))) {
      const innerCoordinates = firstDescendant(inner, "coordinates")?.textContent;
      if (innerCoordinates) rings.push(parseKmlPositions(innerCoordinates));
    }
    return { type: "Polygon", coordinates: rings };
  }
  if (element.localName === "MultiGeometry") {
    const geometries = Array.from(element.children)
      .filter((child) => ["Point", "LineString", "Polygon", "MultiGeometry"].includes(child.localName))
      .map(kmlGeometryToGeoJson);
    return { type: "GeometryCollection", geometries };
  }
  throw new Error(`未対応のKML geometryです: ${element.localName}`);
}

export function convertKml(text: string, source: CrsDefinition, destination: CrsDefinition): { content: string; pointCount: number } {
  if (source.code !== "EPSG:4326") throw new Error("KMLの変換元座標系はWGS84です");
  const documentNode = new DOMParser().parseFromString(text, "application/xml");
  if (documentNode.querySelector("parsererror")) throw new Error("KMLをXMLとして読み取れませんでした");
  const placemarks = Array.from(documentNode.getElementsByTagNameNS("*", "Placemark"));
  const features = placemarks.map((placemark) => {
    const geometryElement = Array.from(placemark.children)
      .find((child) => ["Point", "LineString", "Polygon", "MultiGeometry"].includes(child.localName));
    if (!geometryElement) throw new Error("KMLのPlacemarkに対応するgeometryがありません");
    const name = firstDescendant(placemark, "name")?.textContent ?? undefined;
    const description = firstDescendant(placemark, "description")?.textContent ?? undefined;
    return {
      type: "Feature",
      properties: { ...(name ? { name } : {}), ...(description ? { description } : {}) },
      geometry: kmlGeometryToGeoJson(geometryElement),
    };
  });
  if (!features.length) {
    throw new Error("KMLにPlacemarkがありません");
  }
  return convertGeoJson(JSON.stringify({ type: "FeatureCollection", features }), source, destination);
}

export function convertCoordinateFile(
  text: string,
  inputName: string,
  source: CrsDefinition,
  destination: CrsDefinition,
): ConvertedFile {
  const inputFormat = detectCoordinateFileFormat(inputName);
  const format: CoordinateFileFormat = inputFormat === "kml" ? "geojson" : inputFormat;
  const result = inputFormat === "geojson"
    ? convertGeoJson(text, source, destination)
    : inputFormat === "kml"
      ? convertKml(text, source, destination)
      : convertDelimitedText(text, source, destination);
  return {
    ...result,
    format,
    fileName: outputFileName(inputName, format),
    mimeType: MIME_TYPES[format],
  };
}
