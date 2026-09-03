import type { CrsMetadata } from "../crs/metadata";

export type VectorFormat = "geojson" | "kml" | "shapefile" | "geopackage";
export type DataKind = "vector" | "raster";
export type Position = number[];

export type VectorGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "MultiPoint" | "LineString"; coordinates: Position[] }
  | { type: "MultiLineString" | "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] }
  | { type: "GeometryCollection"; geometries: VectorGeometry[] };

export type VectorFeature = {
  type: "Feature";
  id?: string | number;
  properties: Record<string, unknown>;
  geometry: VectorGeometry | null;
};

export type VectorDataset = {
  kind: "vector";
  format: VectorFormat;
  fileName: string;
  layerName: string;
  crs: CrsMetadata;
  features: VectorFeature[];
  geometryTypes: string[];
  warnings: string[];
};

export type VectorLayerSummary = {
  name: string;
  crs: CrsMetadata;
  geometryType: string;
  featureCount: number;
};

export type VectorFileAnalysis = {
  kind: "vector";
  format: VectorFormat;
  fileName: string;
  fileSize: number;
  layers: VectorLayerSummary[];
  warnings: string[];
};

export type VectorOutput = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  warnings: string[];
};

export const VECTOR_FORMAT_LABELS: Record<VectorFormat, string> = {
  geojson: "GeoJSON",
  kml: "KML",
  shapefile: "Shapefile ZIP",
  geopackage: "GeoPackage",
};

export function supportedOutputFormats(dataKind: DataKind): VectorFormat[] {
  return dataKind === "vector" ? ["geojson", "kml", "shapefile", "geopackage"] : [];
}

