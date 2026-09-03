import type { Coordinate, CrsDefinition } from "../crs/types";

/** UI順をproj4が扱う内部順 [x, y] に変換する唯一の境界。 */
export function uiToInternal(coordinate: Coordinate, crs: CrsDefinition): Coordinate {
  return crs.axisOrder === "northingEasting"
    ? [coordinate[1], coordinate[0]]
    : crs.axisOrder === "latitudeLongitude"
      ? [coordinate[1], coordinate[0]]
      : coordinate;
}

/** 内部順 [x, y] を対象CRSのUI順へ変換する唯一の境界。 */
export function internalToUi(coordinate: Coordinate, crs: CrsDefinition): Coordinate {
  return crs.axisOrder === "northingEasting"
    ? [coordinate[1], coordinate[0]]
    : crs.axisOrder === "latitudeLongitude"
      ? [coordinate[1], coordinate[0]]
      : coordinate;
}
