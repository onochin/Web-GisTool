import sqlWasmUrl from "@ngageoint/geopackage/dist/sql-wasm.wasm?url";
import geoPackageScriptUrl from "@ngageoint/geopackage/dist/geopackage.min.js?url";
import type { GeoPackage, SpatialReferenceSystem } from "@ngageoint/geopackage";
import { CRS_BY_CODE } from "../crs/definitions";
import { detectCrsMetadata, unknownCrs } from "../crs/metadata";
import { geometryTypes, safeLayerName, transformDataset } from "./common";
import { wktForEpsg } from "./crsWkt";
import type { VectorDataset, VectorFeature, VectorGeometry, VectorLayerSummary } from "./types";

let wasmLocator = () => sqlWasmUrl;
type GeoPackageModule = typeof import("@ngageoint/geopackage");
let browserModulePromise: Promise<GeoPackageModule> | null = null;
let testModule: GeoPackageModule | null = null;

declare global {
  interface Window { GeoPackage?: GeoPackageModule }
}

export function setGeoPackageWasmLocatorForTests(locator: (() => string) | null): void {
  wasmLocator = locator ?? (() => sqlWasmUrl);
}

export function setGeoPackageModuleForTests(api: GeoPackageModule | null): void {
  testModule = api;
}

async function moduleApi() {
  let api: GeoPackageModule;
  if (typeof document === "undefined") {
    if (!testModule) throw new Error("GeoPackageのテスト用モジュールが設定されていません。");
    api = testModule;
  } else {
    browserModulePromise ??= new Promise<GeoPackageModule>((resolve, reject) => {
      if (window.GeoPackage) { resolve(window.GeoPackage); return; }
      const script = document.createElement("script");
      script.src = geoPackageScriptUrl;
      script.async = true;
      script.onload = () => window.GeoPackage ? resolve(window.GeoPackage) : reject(new Error("GeoPackageライブラリを初期化できません"));
      script.onerror = () => reject(new Error("GeoPackageライブラリを読み込めません"));
      document.head.appendChild(script);
    });
    api = await browserModulePromise;
  }
  api.Context.setupBrowserContext();
  api.setSqljsWasmLocateFile(wasmLocator);
  return api;
}

function crsFromSrs(srs: { organization?: string; organization_coordsys_id?: number; srs_name?: string }) {
  const epsg = srs.organization?.toUpperCase() === "EPSG" && Number.isFinite(srs.organization_coordsys_id)
    && Number(srs.organization_coordsys_id) > 0 ? Number(srs.organization_coordsys_id) : null;
  if (!epsg) return { ...unknownCrs("xy"), name: srs.srs_name || null, source: "GeoPackage SRS" };
  const known = CRS_BY_CODE.get(`EPSG:${epsg}`);
  return detectCrsMetadata({
    epsg, citation: srs.srs_name ?? null, source: "GeoPackage SRS",
    dataAxisOrder: known?.type === "geographic" ? "longitudeLatitude" : "eastingNorthing",
  });
}

export async function inspectGeoPackage(bytes: Uint8Array): Promise<VectorLayerSummary[]> {
  const { GeoPackageAPI } = await moduleApi();
  const geoPackage = await GeoPackageAPI.open(bytes);
  try {
    const tables = geoPackage.getFeatureTables();
    if (!tables.length) throw new Error("GeoPackage内にVector Feature Tableがありません");
    return tables.map((name) => {
      const dao = geoPackage.getFeatureDao(name);
      return { name, crs: crsFromSrs(dao.srs), geometryType: dao.geometryType, featureCount: dao.getCount() };
    });
  } finally {
    geoPackage.close();
  }
}

export async function readGeoPackage(bytes: Uint8Array, fileName: string, layerName: string): Promise<VectorDataset> {
  const { GeoPackageAPI } = await moduleApi();
  const geoPackage = await GeoPackageAPI.open(bytes);
  try {
    if (!geoPackage.hasFeatureTable(layerName)) throw new Error(`GeoPackageにレイヤー「${layerName}」がありません`);
    const dao = geoPackage.getFeatureDao(layerName);
    const features: VectorFeature[] = [];
    for (const result of dao.queryForEach()) {
      const row = dao.getRow(result);
      const properties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row.values ?? {})) {
        if (key !== row.geometryColumn.name && key !== row.pkColumn.name) properties[key] = value instanceof Date ? value.toISOString() : value;
      }
      const geometry = row.geometry?.geometry?.toGeoJSON() as VectorGeometry | undefined;
      features.push({ type: "Feature", id: row.id, properties, geometry: geometry ?? null });
    }
    return {
      kind: "vector", format: "geopackage", fileName, layerName,
      crs: crsFromSrs(dao.srs), features, geometryTypes: geometryTypes(features), warnings: [],
    };
  } finally {
    geoPackage.close();
  }
}

function datasetPositions(dataset: VectorDataset): number[][] {
  const points: number[][] = [];
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") points.push(value as number[]);
    else value.forEach(visit);
  };
  for (const feature of dataset.features) {
    const visitGeometry = (geometry: VectorGeometry) => {
      if (geometry.type === "GeometryCollection") geometry.geometries.forEach(visitGeometry);
      else visit(geometry.coordinates);
    };
    if (feature.geometry) visitGeometry(feature.geometry);
  }
  return points;
}

function datasetBounds(dataset: VectorDataset): [number, number, number, number] {
  const points = datasetPositions(dataset);
  if (!points.length) return [0, 0, 0, 0];
  return [Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1])), Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1]))];
}

function propertySchema(dataset: VectorDataset, warnings: string[]): { name: string; dataType: string }[] {
  const names = [...new Set(dataset.features.flatMap((feature) => Object.keys(feature.properties)))];
  return names.map((name) => {
    const values = dataset.features.map((feature) => feature.properties[name]).filter((value) => value !== null && value !== undefined);
    if (values.some((value) => typeof value === "object")) warnings.push(`属性「${name}」の配列・オブジェクト値はJSON文字列に変換しました。`);
    const dataType = values.length && values.every((value) => typeof value === "boolean") ? "BOOLEAN"
      : values.length && values.every((value) => typeof value === "number" && Number.isInteger(value)) ? "INTEGER"
        : values.length && values.every((value) => typeof value === "number") ? "REAL"
          : values.length && values.every((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) ? "DATETIME"
            : values.length && values.every((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) ? "DATE" : "TEXT";
    return { name, dataType };
  });
}

function serializableFeatures(dataset: VectorDataset, schema: { name: string; dataType: string }[]): VectorFeature[] {
  const types = new Map(schema.map((field) => [field.name, field.dataType]));
  return dataset.features.map((feature) => ({
    ...feature,
    properties: Object.fromEntries(Object.entries(feature.properties).map(([key, value]) => {
      const type = types.get(key);
      if ((type === "DATE" || type === "DATETIME") && typeof value === "string") return [key, new Date(value)];
      return [key, typeof value === "object" && value !== null ? JSON.stringify(value) : value];
    })),
  }));
}

function safePropertyDataset(dataset: VectorDataset, warnings: string[]): VectorDataset {
  const sourceNames = [...new Set(dataset.features.flatMap((feature) => Object.keys(feature.properties)))];
  const used = new Set(["id", "geometry"]);
  const mapped = new Map<string, string>();
  sourceNames.forEach((source) => {
    let target = source;
    let suffix = 1;
    while (used.has(target.toLowerCase())) target = `${source}_source${suffix++}`;
    used.add(target.toLowerCase());
    mapped.set(source, target);
    if (source !== target) warnings.push(`GeoPackageの予約列との重複を避けるため属性名「${source}」を「${target}」へ変更しました。`);
  });
  return {
    ...dataset,
    features: dataset.features.map((feature) => ({
      ...feature,
      properties: Object.fromEntries(Object.entries(feature.properties).map(([key, value]) => [mapped.get(key)!, value])),
    })),
  };
}

function ensureSrs(
  geoPackage: GeoPackage,
  SpatialReferenceSystemClass: new () => SpatialReferenceSystem,
  epsg: number,
): void {
  if (geoPackage.spatialReferenceSystemDao.getBySrsId(epsg)) return;
  const wkt = wktForEpsg(epsg);
  if (!wkt) throw new Error(`EPSG:${epsg}のGeoPackage用WKTを生成できません`);
  const srs = new SpatialReferenceSystemClass();
  srs.srs_name = CRS_BY_CODE.get(`EPSG:${epsg}`)?.shortName ?? `EPSG:${epsg}`;
  srs.srs_id = epsg;
  srs.organization = "EPSG";
  srs.organization_coordsys_id = epsg;
  srs.definition = wkt;
  srs.definition_12_063 = wkt;
  srs.description = "Created by Web-GisTool";
  geoPackage.createSpatialReferenceSystem(srs);
}

export async function writeGeoPackage(dataset: VectorDataset, layerName: string, epsg: number): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const api = await moduleApi();
  const geoPackage = await api.GeoPackageAPI.create();
  const warnings = [...dataset.warnings];
  try {
    ensureSrs(geoPackage, api.SpatialReferenceSystem, epsg);
    const prepared = safePropertyDataset(dataset, warnings);
    const geometryColumns = new api.GeometryColumns();
    geometryColumns.table_name = safeLayerName(layerName);
    geometryColumns.column_name = "geometry";
    geometryColumns.geometry_type_name = "GEOMETRY";
    geometryColumns.z = datasetPositions(prepared).some((position) => position.length >= 3) ? 2 : 0;
    geometryColumns.m = 0;
    const [xmin, ymin, xmax, ymax] = datasetBounds(prepared);
    const schema = propertySchema(prepared, warnings);
    geoPackage.createFeatureTable(
      geometryColumns.table_name,
      geometryColumns,
      schema,
      new api.BoundingBox(xmin, xmax, ymin, ymax),
      epsg,
    );
    geoPackage.loadSpatialReferenceSystemsIntoProj4();
    const wgs84 = transformDataset({ ...prepared, features: serializableFeatures(prepared, schema) }, 4326, epsg);
    await geoPackage.addGeoJSONFeaturesToGeoPackage(wgs84.features as never[], geometryColumns.table_name, false, 500);
    const result = await geoPackage.export();
    return { bytes: result instanceof Uint8Array ? result : new Uint8Array(result), warnings };
  } finally {
    geoPackage.close();
  }
}
