import type { Coordinate, CrsDefinition } from "../crs/types";

export class CoordinateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoordinateValidationError";
  }
}

export function parseFiniteNumber(value: string | number, label: string): number {
  if (String(value).trim() === "") throw new CoordinateValidationError(`${label}を入力してください`);
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new CoordinateValidationError(`${label}には有限の数値を入力してください`);
  return parsed;
}

export function validateUiCoordinate(coordinate: Coordinate, crs: CrsDefinition): Coordinate {
  if (!coordinate.every(Number.isFinite)) {
    throw new CoordinateValidationError("座標には有限の数値を入力してください");
  }
  if (crs.type === "geographic") {
    const [latitude, longitude] = coordinate;
    if (latitude < -90 || latitude > 90) throw new CoordinateValidationError("緯度は-90～90の範囲で入力してください");
    if (longitude < -180 || longitude > 180) throw new CoordinateValidationError("経度は-180～180の範囲で入力してください");
  }
  return coordinate;
}
