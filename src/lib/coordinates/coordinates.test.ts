import { describe, expect, it } from "vitest";
import { resolveCrs } from "../crs/resolver";
import { transformBatch } from "./parser";
import { transformCoordinate } from "./transform";

const wgs84 = resolveCrs(4326);
const jgd2011 = resolveCrs(6668);
const webMercator = resolveCrs(3857);
const zone9 = resolveCrs(6677);
const jgd2000 = resolveCrs(4612);
const jgd2000Zone8 = resolveCrs(2450);
const tokyoStation = [35.681236, 139.767125] as const;

describe("EPSG resolver", () => {
  it.each(["4326", "EPSG:4326", "epsg: 4326"])("%sを解決する", (input) => {
    expect(resolveCrs(input).code).toBe("EPSG:4326");
  });

  it("未登録EPSGを拒否する", () => {
    expect(() => resolveCrs("999999")).toThrow("現在このツールに登録されていません");
  });

  it("EPSG:2450をJGD2000平面直角VIII系として解決する", () => {
    expect(resolveCrs("EPSG:2450")).toMatchObject({
      shortName: "JGD2000 / 平面直角 VIII系",
      planeRectangularZone: 8,
      axisOrder: "northingEasting",
    });
  });
});

describe("基本変換", () => {
  it("EPSG:4326 → EPSG:3857 → EPSG:4326", () => {
    const projected = transformCoordinate(tokyoStation, wgs84, webMercator);
    expect(projected[0]).toBeCloseTo(15558805.184640, 3);
    expect(projected[1]).toBeCloseTo(4256848.120220, 3);
    const restored = transformCoordinate(projected, webMercator, wgs84);
    expect(restored[0]).toBeCloseTo(tokyoStation[0], 9);
    expect(restored[1]).toBeCloseTo(tokyoStation[1], 9);
  });

  it("EPSG:4326 → EPSG:6668 → EPSG:4326", () => {
    const jgd = transformCoordinate(tokyoStation, wgs84, jgd2011);
    expect(jgd[0]).toBeCloseTo(tokyoStation[0], 9);
    expect(jgd[1]).toBeCloseTo(tokyoStation[1], 9);
    const restored = transformCoordinate(jgd, jgd2011, wgs84);
    expect(restored[0]).toBeCloseTo(tokyoStation[0], 9);
    expect(restored[1]).toBeCloseTo(tokyoStation[1], 9);
  });

  it("EPSG:4326 → 平面直角IX系でUI順がX=Northing, Y=Eastingになる", () => {
    // PROJ 9.x の EPSG database と cs2cs で取得:
    // echo '35.681236 139.767125' | cs2cs EPSG:4326 EPSG:6677 -f '%.6f'
    // EPSG:6677 の公式軸順も northing, easting。2026-09-03確認。
    const result = transformCoordinate(tokyoStation, wgs84, zone9);
    expect(result[0]).toBeCloseTo(-35363.237745, 3); // X = Northing
    expect(result[1]).toBeCloseTo(-5992.919570, 3); // Y = Easting
  });

  it("国土地理院の既知値で平面直角II系のX/Yを検証する", () => {
    // 出典: 国土地理院「平面直角座標への変換」No.2
    // https://www.gsi.go.jp/common/000260486.pdf
    // 33°15′10.07544″, 130°46′20.19192″ → X=28057.394m, Y=-21218.586m
    const source = [33.252798733333, 130.772275533333] as const;
    const result = transformCoordinate(source, wgs84, resolveCrs(6670));
    expect(result[0]).toBeCloseTo(28057.394, 3);
    expect(result[1]).toBeCloseTo(-21218.586, 3);
  });

  it("平面直角IX系 → EPSG:4326の往復で元へ戻る", () => {
    const plane = transformCoordinate(tokyoStation, wgs84, zone9);
    const restored = transformCoordinate(plane, zone9, wgs84);
    expect(restored[0]).toBeCloseTo(tokyoStation[0], 8);
    expect(restored[1]).toBeCloseTo(tokyoStation[1], 8);
  });

  it("JGD2000 → EPSG:2450の原点とX=Northing, Y=Eastingを検証する", () => {
    // EPSG:2450: lat_0=36, lon_0=138.5, axis=Northing(X),Easting(Y)
    // PROJのEPSG database（projinfo EPSG:2450）で2026-09-03確認。
    const origin = transformCoordinate([36, 138.5], jgd2000, jgd2000Zone8);
    expect(origin[0]).toBeCloseTo(0, 6);
    expect(origin[1]).toBeCloseTo(0, 6);
    const restored = transformCoordinate(origin, jgd2000Zone8, jgd2000);
    expect(restored[0]).toBeCloseTo(36, 9);
    expect(restored[1]).toBeCloseTo(138.5, 9);
  });
});

describe("複数点", () => {
  it("不正行があっても正常行を変換する", () => {
    const results = transformBatch("35.681236,139.767125\ninvalid\n35.6895\t139.6917\n\n", wgs84, zone9);
    expect(results).toHaveLength(3);
    expect(results.map((result) => result.status)).toEqual(["success", "error", "success"]);
    expect(results[1].lineNumber).toBe(2);
    expect(results[2].lineNumber).toBe(3);
  });
});
