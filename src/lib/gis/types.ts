export type GisKind = "vector" | "raster";
export type GisFormat = "GeoJSON" | "KML" | "GeoTIFF";

export type Bounds = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

export type CrsInfo = CrsMetadata;

export type FieldInfo = {
  name: string;
  type: string;
};

export type VectorInfo = {
  geometryType: string;
  geometryTypes: string[];
  featureCount: number;
  hasZ: boolean;
  hasM: boolean | null;
  fields: FieldInfo[];
};

export type RasterInfo = {
  width: number;
  height: number;
  bands: number;
  resolution: readonly [number, number] | null;
  dataType: string;
  noData: string | null;
  compression: string;
  hasOverviews: boolean;
};

export type GisMetadata = {
  kind: GisKind;
  format: GisFormat;
  fileName: string;
  fileSize: number;
  crs: CrsInfo;
  bounds: Bounds | null;
  vector?: VectorInfo;
  raster?: RasterInfo;
};
import type { CrsMetadata } from "../crs/metadata";

