import { describe, expect, it } from "vitest";
import { detectCrsMetadata, normalizeCrsAlias } from "./metadata";

describe("CRSメタデータ正規化", () => {
  it.each([
    "OGC:CRS84",
    "CRS84",
    "urn:ogc:def:crs:OGC:1.3:CRS84",
    "urn:ogc:def:crs:OGC::CRS84",
  ])("%sをOGC:CRS84へ正規化する", (identifier) => {
    expect(normalizeCrsAlias(identifier)).toBe("OGC:CRS84");
  });

  it("CRS84をWGS84かつEPSG:4326相当として判定する", () => {
    expect(detectCrsMetadata({
      identifier: "urn:ogc:def:crs:OGC:1.3:CRS84",
      source: "GeoJSON crsプロパティ",
      convention: "geojson",
    })).toEqual({
      name: "WGS84 / OGC:CRS84",
      epsg: null,
      equivalentEpsg: 4326,
      unit: "degree",
      type: "geographic",
      axisOrder: "longitudeLatitude",
      dataAxisOrder: "longitudeLatitude",
      source: "GeoJSON crsプロパティ（OGC:CRS84）",
    });
  });

  it("CRS情報なしGeoJSONを標準に基づくWGS84として推定する", () => {
    expect(detectCrsMetadata({ convention: "geojson" })).toMatchObject({
      name: "WGS84",
      epsg: null,
      equivalentEpsg: 4326,
      dataAxisOrder: "longitudeLatitude",
      source: "GeoJSON標準による推定",
    });
  });

  it("明示されたEPSG:4326をEPSGコードとして判定する", () => {
    expect(detectCrsMetadata({
      identifier: "EPSG:4326",
      source: "GeoJSON crsプロパティ",
      convention: "geojson",
    })).toMatchObject({ epsg: 4326, equivalentEpsg: null, source: "GeoJSON crsプロパティ" });
  });

  it("CRS84とEPSG:4326のCRS軸順を混同しない", () => {
    const crs84 = detectCrsMetadata({ identifier: "OGC:CRS84", convention: "geojson" });
    const epsg4326 = detectCrsMetadata({ identifier: "EPSG:4326", convention: "geojson" });
    expect(crs84.axisOrder).toBe("longitudeLatitude");
    expect(epsg4326.axisOrder).toBe("latitudeLongitude");
    expect(epsg4326.dataAxisOrder).toBe("longitudeLatitude");
  });

  it("未知のCRS文字列を推定しない", () => {
    expect(detectCrsMetadata({
      identifier: "LOCAL:UNKNOWN_GRID",
      source: "GeoJSON crsプロパティ",
      convention: "geojson",
    })).toMatchObject({ name: null, epsg: null, equivalentEpsg: null, type: null, axisOrder: null, dataAxisOrder: "xy" });
  });
});

