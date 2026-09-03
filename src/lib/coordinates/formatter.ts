import type { Coordinate, CrsDefinition } from "../crs/types";

export function formatNumber(value: number, crs: CrsDefinition): string {
  const digits = crs.type === "geographic" ? 9 : 3;
  return value.toFixed(digits);
}

export function formatCoordinate(coordinate: Coordinate, crs: CrsDefinition, separator = ","): string {
  return coordinate.map((value) => formatNumber(value, crs)).join(separator);
}
