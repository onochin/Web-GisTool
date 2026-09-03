import { CRS_BY_CODE } from "./definitions";

export type MetadataAxisOrder =
  | "longitudeLatitude"
  | "latitudeLongitude"
  | "eastingNorthing"
  | "northingEasting"
  | "xy";

export type CrsMetadata = {
  name: string | null;
  /** CRSとして明示されたEPSGコード。相当コードとは区別する。 */
  epsg: number | null;
  equivalentEpsg: number | null;
  unit: string | null;
  type: "geographic" | "projected" | null;
  /** CRS定義上の軸順序。 */
  axisOrder: MetadataAxisOrder | null;
  /** 対象ファイル内の座標配列順序。 */
  dataAxisOrder: MetadataAxisOrder | null;
  source: string | null;
};

type DetectCrsOptions = {
  identifier?: string | null;
  epsg?: number | null;
  citation?: string | null;
  source?: string | null;
  convention?: "geojson" | "kml";
  type?: CrsMetadata["type"];
  unit?: string | null;
  dataAxisOrder?: MetadataAxisOrder | null;
};

const CRS84_ALIASES = new Set(["CRS84", "OGC:CRS84"]);

function normalizedIdentifier(identifier: string): string {
  return identifier.trim().toUpperCase().replace(/\s+/g, "");
}

export function normalizeCrsAlias(identifier: string): "OGC:CRS84" | null {
  const normalized = normalizedIdentifier(identifier);
  if (CRS84_ALIASES.has(normalized)) return "OGC:CRS84";
  if (/^URN:OGC:DEF:CRS:OGC(?::[^:]*)?:CRS84$/.test(normalized)) return "OGC:CRS84";
  return null;
}

function extractEpsg(identifier: string): number | null {
  const match = normalizedIdentifier(identifier).match(/(?:^|:)EPSG(?::|::|\/)(\d+)$/);
  return match ? Number(match[1]) : null;
}

function axisOrderForEpsg(epsg: number): MetadataAxisOrder | null {
  const known = CRS_BY_CODE.get(`EPSG:${epsg}`);
  return known?.axisOrder ?? null;
}

function fromEpsg(epsg: number, options: DetectCrsOptions): CrsMetadata {
  const known = CRS_BY_CODE.get(`EPSG:${epsg}`);
  const geoJsonOrder = known?.type === "projected" ? "eastingNorthing" : "longitudeLatitude";
  return {
    name: known?.name ?? options.citation ?? `EPSG:${epsg}`,
    epsg,
    equivalentEpsg: null,
    unit: options.unit ?? known?.unit ?? null,
    type: options.type ?? known?.type ?? null,
    axisOrder: axisOrderForEpsg(epsg),
    dataAxisOrder: options.dataAxisOrder ?? (options.convention === "geojson" ? geoJsonOrder : axisOrderForEpsg(epsg)),
    source: options.source ?? "EPSGコード",
  };
}

function wgs84Equivalent(name: string, source: string, dataAxisOrder: MetadataAxisOrder = "longitudeLatitude"): CrsMetadata {
  return {
    name,
    epsg: null,
    equivalentEpsg: 4326,
    unit: "degree",
    type: "geographic",
    axisOrder: "longitudeLatitude",
    dataAxisOrder,
    source,
  };
}

export function unknownCrs(dataAxisOrder: MetadataAxisOrder | null = null): CrsMetadata {
  return {
    name: null, epsg: null, equivalentEpsg: null, unit: null, type: null,
    axisOrder: null, dataAxisOrder, source: null,
  };
}

export function detectCrsMetadata(options: DetectCrsOptions): CrsMetadata {
  const identifier = options.identifier?.trim();
  if (identifier) {
    if (normalizeCrsAlias(identifier) === "OGC:CRS84") {
      return wgs84Equivalent("WGS84 / OGC:CRS84", `${options.source ?? "CRS情報"}（OGC:CRS84）`, options.dataAxisOrder ?? "longitudeLatitude");
    }
    const identifierEpsg = extractEpsg(identifier);
    if (identifierEpsg) return fromEpsg(identifierEpsg, options);
    return {
      ...unknownCrs(options.dataAxisOrder ?? (options.convention === "geojson" ? "xy" : null)),
      source: `${options.source ?? "明示されたCRS情報"}（未対応のCRS表記: ${identifier}）`,
    };
  }
  if (options.epsg) return fromEpsg(options.epsg, options);
  if (options.convention === "geojson") return wgs84Equivalent("WGS84", "GeoJSON標準による推定");
  if (options.convention === "kml") return wgs84Equivalent("WGS84", "KML仕様による判定");
  const unknown = unknownCrs(options.dataAxisOrder ?? null);
  return {
    ...unknown,
    name: options.citation ?? null,
    unit: options.unit ?? null,
    type: options.type ?? null,
    source: options.source ?? null,
  };
}
