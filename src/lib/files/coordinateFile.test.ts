import { describe, expect, it } from "vitest";
import { resolveCrs } from "../crs/resolver";
import { convertDelimitedText, convertGeoJson, detectCoordinateFileFormat } from "./coordinateFile";

const wgs84 = resolveCrs(4326);
const zone9 = resolveCrs(6677);

describe("座標ファイル形式", () => {
  it.each([
    ["points.geojson", "geojson"],
    ["points.JSON", "geojson"],
    ["points.kml", "kml"],
    ["points.csv", "csv"],
    ["points.tsv", "csv"],
  ] as const)("%sを%sとして判定する", (name, format) => {
    expect(detectCoordinateFileFormat(name)).toBe(format);
  });

  it("未対応拡張子を拒否する", () => {
    expect(() => detectCoordinateFileFormat("points.exe")).toThrow("対応形式");
  });
});

describe("GeoJSON変換", () => {
  it("GIS標準のx=longitude, y=latitude順で全座標と高さを維持する", () => {
    const input = JSON.stringify({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { name: "東京駅" },
        geometry: { type: "Point", coordinates: [139.767125, 35.681236, 12.5] },
      }],
    });
    const result = convertGeoJson(input, wgs84, zone9);
    const output = JSON.parse(result.content);
    expect(result.pointCount).toBe(1);
    expect(output.features[0].geometry.coordinates[0]).toBeCloseTo(-5992.919570, 3);
    expect(output.features[0].geometry.coordinates[1]).toBeCloseTo(-35363.237745, 3);
    expect(output.features[0].geometry.coordinates[2]).toBe(12.5);
    expect(output.crs.properties.name).toBe("EPSG:6677");
  });
});

describe("CSV/TSV変換", () => {
  it("ヘッダーを維持し、先頭2列をUI順で変換する", () => {
    const result = convertDelimitedText("latitude,longitude,name\n35.681236,139.767125,東京駅", wgs84, zone9);
    const lines = result.content.split("\n");
    const coordinate = lines[1].split(",").slice(0, 2).map(Number);
    expect(lines[0]).toBe("latitude,longitude,name");
    expect(coordinate[0]).toBeCloseTo(-35363.237745, 3);
    expect(coordinate[1]).toBeCloseTo(-5992.919570, 3);
    expect(lines[1]).toContain("東京駅");
    expect(result.pointCount).toBe(1);
  });

  it("データ開始後の空欄を拒否する", () => {
    expect(() => convertDelimitedText("35,139\n,140", wgs84, zone9)).toThrow("2行目");
  });
});
