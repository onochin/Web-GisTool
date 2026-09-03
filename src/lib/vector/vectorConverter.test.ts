import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as geoPackageApi from "@ngageoint/geopackage";
import { detectCrsMetadata, unknownCrs } from "../crs/metadata";
import { transformInternalCoordinate } from "../coordinates/transform";
import { resolveCrs } from "../crs/resolver";
import { transformDataset } from "./common";
import { readGeoJson, writeGeoJson } from "./geojson";
import { inspectGeoPackage, readGeoPackage, setGeoPackageModuleForTests, setGeoPackageWasmLocatorForTests, writeGeoPackage } from "./geopackage";
import { readKml, writeKml } from "./kml";
import { readShapefileZip, writeShapefileZip } from "./shapefile";
import type { VectorDataset, VectorFormat, VectorGeometry } from "./types";

const originalFetch = globalThis.fetch;

beforeAll(() => {
  Object.defineProperty(globalThis, "fetch", { value: undefined, configurable: true, writable: true });
  setGeoPackageModuleForTests(geoPackageApi);
  setGeoPackageWasmLocatorForTests(() => `${process.cwd()}/node_modules/@ngageoint/geopackage/dist/sql-wasm.wasm`);
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  setGeoPackageModuleForTests(null);
  setGeoPackageWasmLocatorForTests(null);
});

function dataset(geometry: VectorGeometry, epsg = 4326): VectorDataset {
  return {
    kind: "vector", format: "geojson", fileName: "sample.geojson", layerName: "日本語レイヤー",
    crs: detectCrsMetadata({ epsg, source: "テスト", convention: "geojson" }),
    geometryTypes: [geometry.type], warnings: [],
    features: [{
      type: "Feature", id: 1,
      properties: { count: 12, ratio: 1.5, name: "東京都", 名称: "東京都", empty: null, active: true, date: "2026-09-04" },
      geometry,
    }],
  };
}

describe("GeoJSON / KML", () => {
  it("GeoJSONからKMLへGeometryと属性を変換する", () => {
    const source = dataset({ type: "Point", coordinates: [139.7, 35.6, 10] });
    const kml = new TextDecoder().decode(writeKml(source));
    expect(kml).toContain("<Point>");
    expect(kml).toContain("139.7,35.6,10");
    expect(kml).toContain("東京都");
  });

  it("KMLからGeoJSONへ変換する", () => {
    const kml = '<?xml version="1.0"?><kml><Document><Placemark><name>道路</name><ExtendedData><Data name="番号"><value>1</value></Data></ExtendedData><LineString><coordinates>139,35 140,36</coordinates></LineString></Placemark></Document></kml>';
    const result = readKml(kml, "road.kml");
    expect(result.features[0]).toMatchObject({ properties: { name: "道路", 番号: "1" }, geometry: { type: "LineString" } });
    expect(JSON.parse(new TextDecoder().decode(writeGeoJson(result))).features).toHaveLength(1);
  });

  it("GeoJSONの数値・文字列・日本語・nullを維持する", () => {
    const source = dataset({ type: "Point", coordinates: [139, 35] });
    const result = readGeoJson(new TextDecoder().decode(writeGeoJson(source)), "sample.geojson");
    expect(result.features[0].properties).toMatchObject({ count: 12, ratio: 1.5, name: "東京都", empty: null });
  });
});

describe("Shapefile ZIP", () => {
  const geometryCases: Array<[string, VectorGeometry]> = [
    ["Point", { type: "Point", coordinates: [139, 35] }],
    ["MultiPoint", { type: "MultiPoint", coordinates: [[139, 35], [140, 36]] }],
    ["LineString", { type: "LineString", coordinates: [[139, 35], [140, 36]] }],
    ["MultiLineString", { type: "MultiLineString", coordinates: [[[139, 35], [140, 36]], [[141, 37], [142, 38]]] }],
    ["Polygon", { type: "Polygon", coordinates: [[[139, 35], [140, 35], [140, 36], [139, 35]]] }],
    ["MultiPolygon", { type: "MultiPolygon", coordinates: [[[[139, 35], [140, 35], [140, 36], [139, 35]]], [[[141, 37], [142, 37], [142, 38], [141, 37]]]] }],
  ];

  it.each(geometryCases)("%sをSHP/SHX/DBFへ書き出して読み戻す", async (_name, geometry) => {
    const output = writeShapefileZip(dataset(geometry), 4326);
    const layers = await readShapefileZip(output.bytes, "sample.zip");
    expect(layers).toHaveLength(1);
    expect(layers[0].features).toHaveLength(1);
    expect(layers[0].features[0].geometry).not.toBeNull();
  });

  it("日本語属性値をUTF-8で維持し、制約による属性名変更を警告する", async () => {
    const output = writeShapefileZip(dataset({ type: "Point", coordinates: [139, 35] }), 4326);
    expect(output.warnings.some((warning) => warning.includes("属性名"))).toBe(true);
    const [result] = await readShapefileZip(output.bytes, "sample.zip");
    expect(Object.values(result.features[0].properties)).toContain("東京都");
  });
});

describe("GeoPackage", () => {
  it("GeoJSONから1レイヤーGeoPackageを生成し、一覧・指定レイヤー・属性を読み戻す", async () => {
    const output = await writeGeoPackage(dataset({ type: "Point", coordinates: [139, 35] }), "places", 4326);
    const layers = await inspectGeoPackage(output.bytes);
    expect(layers).toMatchObject([{ name: "places", featureCount: 1, crs: { epsg: 4326 } }]);
    const result = await readGeoPackage(output.bytes, "places.gpkg", "places");
    expect(result.features[0].properties).toMatchObject({ count: 12, name: "東京都", empty: null });
    expect(JSON.parse(new TextDecoder().decode(writeGeoJson(transformDataset(result, 4326)))).features).toHaveLength(1);
  }, 15_000);

  it("JGD2011平面直角IX系をGeoPackageで維持する", async () => {
    const source = dataset({ type: "Point", coordinates: [-35000, -25000] }, 6677);
    const output = await writeGeoPackage(source, "plane_ix", 6677);
    const [layer] = await inspectGeoPackage(output.bytes);
    const result = await readGeoPackage(output.bytes, "plane.gpkg", "plane_ix");
    expect(layer.crs.epsg).toBe(6677);
    expect((result.features[0].geometry as { coordinates: number[] }).coordinates[0]).toBeCloseTo(-35000, 3);
    expect((result.features[0].geometry as { coordinates: number[] }).coordinates[1]).toBeCloseTo(-25000, 3);
  }, 15_000);
});

describe("全形式間の変換", () => {
  const formats: VectorFormat[] = ["geojson", "kml", "shapefile", "geopackage"];
  const pairs = formats.flatMap((input) => formats.filter((output) => output !== input).map((output) => [input, output] as const));

  async function encode(format: VectorFormat, source: VectorDataset): Promise<Uint8Array> {
    if (format === "geojson") return writeGeoJson(source);
    if (format === "kml") return writeKml(source);
    if (format === "shapefile") return writeShapefileZip(source, 4326).bytes;
    return (await writeGeoPackage(source, "features", 4326)).bytes;
  }

  async function decode(format: VectorFormat, bytes: Uint8Array): Promise<VectorDataset> {
    if (format === "geojson") return readGeoJson(new TextDecoder().decode(bytes), "features.geojson");
    if (format === "kml") return readKml(new TextDecoder().decode(bytes), "features.kml");
    if (format === "shapefile") return (await readShapefileZip(bytes, "features.zip"))[0];
    return readGeoPackage(bytes, "features.gpkg", "features");
  }

  it.each(pairs)("%s → %s", async (input, output) => {
    const source = dataset({ type: "Point", coordinates: [139.7, 35.6, 8] });
    const inputBytes = await encode(input, source);
    const decoded = await decode(input, inputBytes);
    const outputBytes = await encode(output, transformDataset(decoded, 4326));
    const result = await decode(output, outputBytes);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry?.type).toBe("Point");
  }, 15_000);
});

describe("CRS変換ルール", () => {
  it("JGD2011平面直角IX系からKML用WGS84へ既存ロジックで変換する", () => {
    const source = dataset({ type: "Point", coordinates: [-35000, -25000] }, 6677);
    const result = transformDataset(source, 4326);
    const expected = transformInternalCoordinate([-35000, -25000], resolveCrs(6677), resolveCrs(4326));
    expect((result.features[0].geometry as { coordinates: number[] }).coordinates.slice(0, 2)).toEqual(expected);
  });

  it("CRS不明データをKML用WGS84と仮定しない", () => {
    const source = { ...dataset({ type: "Point", coordinates: [1, 2] }), crs: unknownCrs("xy") };
    expect(() => transformDataset(source, 4326)).toThrow("EPSG番号を指定してください");
  });
});
