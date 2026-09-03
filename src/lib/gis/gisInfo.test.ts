import { describe, expect, it } from "vitest";
import { detectGisFormat } from "./analyze";
import { arrayBufferSource, parseGeoTiff } from "./geotiff";
import { parseGeoJson } from "./vector";

type TiffEntry = { tag: number; type: 2 | 3 | 4 | 12; value: number | number[] | string };

function createGeoTiff(withCrs = true): ArrayBuffer {
  const entries: TiffEntry[] = [
    { tag: 256, type: 4, value: 2 },
    { tag: 257, type: 4, value: 3 },
    { tag: 258, type: 3, value: 16 },
    { tag: 259, type: 3, value: 1 },
    { tag: 277, type: 3, value: 1 },
    { tag: 339, type: 3, value: 1 },
    { tag: 33550, type: 12, value: [10, 10, 0] },
    { tag: 33922, type: 12, value: [0, 0, 0, 100, 200, 0] },
    { tag: 42113, type: 2, value: "-9999\0" },
  ];
  if (withCrs) entries.push({
    tag: 34735,
    type: 3,
    value: [1, 1, 0, 3, 1024, 0, 1, 1, 3072, 0, 1, 3857, 3076, 0, 1, 9001],
  });
  entries.sort((left, right) => left.tag - right.tag);

  const typeSize = { 2: 1, 3: 2, 4: 4, 12: 8 } as const;
  const itemCount = (entry: TiffEntry) => typeof entry.value === "string"
    ? new TextEncoder().encode(entry.value).length
    : Array.isArray(entry.value) ? entry.value.length : 1;
  const externalSize = entries.reduce((total, entry) => {
    const length = itemCount(entry) * typeSize[entry.type];
    return total + (length > 4 ? length : 0);
  }, 0);
  const ifdOffset = 8;
  const tableSize = 2 + entries.length * 12 + 4;
  const buffer = new ArrayBuffer(ifdOffset + tableSize + externalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes[0] = 0x49; bytes[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entries.length, true);
  let externalOffset = ifdOffset + tableSize;

  entries.forEach((entry, index) => {
    const offset = ifdOffset + 2 + index * 12;
    const count = itemCount(entry);
    const byteLength = count * typeSize[entry.type];
    view.setUint16(offset, entry.tag, true);
    view.setUint16(offset + 2, entry.type, true);
    view.setUint32(offset + 4, count, true);
    const valueOffset = byteLength > 4 ? externalOffset : offset + 8;
    if (byteLength > 4) {
      view.setUint32(offset + 8, externalOffset, true);
      externalOffset += byteLength;
    }
    if (typeof entry.value === "string") {
      bytes.set(new TextEncoder().encode(entry.value), valueOffset);
    } else {
      const values = Array.isArray(entry.value) ? entry.value : [entry.value];
      values.forEach((value, valueIndex) => {
        const target = valueOffset + valueIndex * typeSize[entry.type];
        if (entry.type === 3) view.setUint16(target, value, true);
        else if (entry.type === 4) view.setUint32(target, value, true);
        else view.setFloat64(target, value, true);
      });
    }
  });
  view.setUint32(ifdOffset + 2 + entries.length * 12, 0, true);
  return buffer;
}

const geoJson = JSON.stringify({
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { id: 1, name: "A", area: 1.5 }, geometry: { type: "Point", coordinates: [139, 35, 12] } },
    { type: "Feature", properties: { id: 2, name: "B", area: 2 }, geometry: { type: "LineString", coordinates: [[140, 34], [141, 36]] } },
  ],
});

describe("GISファイル形式判定", () => {
  it("内容からVectorのGeoJSONを判定する", () => {
    expect(detectGisFormat("data.bin", new Uint8Array(), "  {\"type\":\"Point\"}")).toBe("GeoJSON");
  });

  it("内容からRasterのGeoTIFFを判定する", () => {
    expect(detectGisFormat("data.bin", new Uint8Array(createGeoTiff()).slice(0, 4))).toBe("GeoTIFF");
  });

  it("KML形式を判定する", () => {
    expect(detectGisFormat("data.xml", new Uint8Array(), "<?xml version=\"1.0\"?><kml></kml>")).toBe("KML");
  });

  it("未対応形式を拒否する", () => {
    expect(() => detectGisFormat("data.shp", new Uint8Array([1, 2, 3]), "abc")).toThrow("対応していません");
  });
});

describe("GeoJSON情報取得", () => {
  it("基本情報・属性型・Bounding Box・Zを取得する", () => {
    const result = parseGeoJson(geoJson, "sample.geojson", geoJson.length);
    expect(result.kind).toBe("vector");
    expect(result.vector).toMatchObject({ geometryType: "Mixed", featureCount: 2, hasZ: true });
    expect(result.vector?.fields).toEqual([
      { name: "id", type: "Integer" }, { name: "name", type: "String" }, { name: "area", type: "Real" },
    ]);
    expect(result.bounds).toEqual({ xmin: 139, ymin: 34, xmax: 141, ymax: 36 });
  });

  it("CRSなしのGeoJSONを標準に基づくWGS84として示す", () => {
    const result = parseGeoJson(geoJson, "sample.geojson", geoJson.length);
    expect(result.crs).toMatchObject({ equivalentEpsg: 4326, source: "GeoJSON標準による推定" });
  });

  it("crsプロパティのOGC:CRS84 URNを認識する", () => {
    const input = JSON.stringify({
      type: "FeatureCollection",
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
      features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [139, 35] } }],
    });
    expect(parseGeoJson(input, "qgis.geojson", input.length).crs).toMatchObject({
      name: "WGS84 / OGC:CRS84",
      epsg: null,
      equivalentEpsg: 4326,
      axisOrder: "longitudeLatitude",
      dataAxisOrder: "longitudeLatitude",
      source: "GeoJSON crsプロパティ（OGC:CRS84）",
    });
  });

  it("不正ファイルを拒否する", () => {
    expect(() => parseGeoJson("{broken", "broken.geojson", 7)).toThrow("GeoJSONを読み込めません");
  });
});

describe("GeoTIFF情報取得", () => {
  it("基本情報・CRS・Bounding Boxを取得する", async () => {
    const buffer = createGeoTiff();
    const result = await parseGeoTiff(arrayBufferSource(buffer), "sample.tif");
    expect(result.kind).toBe("raster");
    expect(result.raster).toMatchObject({ width: 2, height: 3, bands: 1, noData: "-9999", compression: "None" });
    expect(result.raster?.resolution).toEqual([10, 10]);
    expect(result.crs).toMatchObject({ epsg: 3857, type: "projected", unit: "metre" });
    expect(result.bounds).toEqual({ xmin: 100, ymin: 170, xmax: 120, ymax: 200 });
  });

  it("GeoKeyがない場合はCRSを推測しない", async () => {
    const result = await parseGeoTiff(arrayBufferSource(createGeoTiff(false)), "unknown.tif");
    expect(result.crs).toEqual({
      name: null, epsg: null, equivalentEpsg: null, unit: null, type: null,
      axisOrder: null, dataAxisOrder: null, source: null,
    });
  });

  it("不正なTIFFを拒否する", async () => {
    await expect(parseGeoTiff(arrayBufferSource(new Uint8Array([1, 2, 3]).buffer), "broken.tif")).rejects.toThrow("壊れています");
  });
});
