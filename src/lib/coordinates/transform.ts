import proj4 from "proj4";
import { CRS_DEFINITIONS } from "../crs/definitions";
import type { Coordinate, CrsDefinition } from "../crs/types";
import { internalToUi, uiToInternal } from "./normalize";
import { validateUiCoordinate } from "./validation";

let registered = false;

export function registerCrsDefinitions(): void {
  if (registered) return;
  for (const crs of CRS_DEFINITIONS) proj4.defs(crs.code, crs.proj4);
  registered = true;
}

export function transformCoordinate(
  uiCoordinate: Coordinate,
  source: CrsDefinition,
  destination: CrsDefinition,
): Coordinate {
  validateUiCoordinate(uiCoordinate, source);
  registerCrsDefinitions();
  try {
    const result = proj4(source.code, destination.code, [...uiToInternal(uiCoordinate, source)]);
    if (!result.every(Number.isFinite)) throw new Error("結果が有限値ではありません");
    return internalToUi([result[0], result[1]], destination);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`座標を変換できませんでした: ${detail}`);
  }
}

/** GISファイルで一般的な順序 [x, y] の座標を変換する。 */
export function transformInternalCoordinate(
  coordinate: Coordinate,
  source: CrsDefinition,
  destination: CrsDefinition,
): Coordinate {
  validateUiCoordinate(internalToUi(coordinate, source), source);
  registerCrsDefinitions();
  try {
    const result = proj4(source.code, destination.code, [...coordinate]);
    if (!result.every(Number.isFinite)) throw new Error("結果が有限値ではありません");
    return [result[0], result[1]];
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`座標を変換できませんでした: ${detail}`);
  }
}
