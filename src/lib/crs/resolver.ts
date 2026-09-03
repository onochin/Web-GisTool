import { CRS_BY_CODE } from "./definitions";
import type { CrsDefinition } from "./types";

export class CrsResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrsResolutionError";
  }
}

export function normalizeEpsgCode(input: string | number): `EPSG:${number}` {
  const raw = String(input).trim().toUpperCase();
  const match = /^(?:EPSG\s*:\s*)?(\d+)$/.exec(raw);
  if (!match) {
    throw new CrsResolutionError("EPSGコードは「4326」または「EPSG:4326」の形式で入力してください");
  }
  return `EPSG:${Number(match[1])}`;
}

export function resolveCrs(input: string | number): CrsDefinition {
  const code = normalizeEpsgCode(input);
  const definition = CRS_BY_CODE.get(code);
  if (!definition) {
    throw new CrsResolutionError(`このEPSGコード（${code}）は現在このツールに登録されていません`);
  }
  return definition;
}
