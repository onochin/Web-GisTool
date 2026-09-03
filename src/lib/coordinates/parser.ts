import type { Coordinate, CrsDefinition } from "../crs/types";
import { transformCoordinate } from "./transform";
import { validateUiCoordinate } from "./validation";

export type BatchResult = {
  lineNumber: number;
  input: string;
  inputCoordinate?: Coordinate;
  outputCoordinate?: Coordinate;
  status: "success" | "error";
  error?: string;
};

export function parseCoordinateLine(line: string, crs: CrsDefinition): Coordinate {
  const parts = line.trim().split(/[\t,]/).map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => part === "")) {
    throw new Error("座標は2つの値をカンマまたはタブで区切ってください");
  }
  const values = parts.map(Number);
  if (!values.every(Number.isFinite)) throw new Error("座標には有限の数値を入力してください");
  return validateUiCoordinate([values[0], values[1]], crs);
}

export function transformBatch(
  text: string,
  source: CrsDefinition,
  destination: CrsDefinition,
): BatchResult[] {
  return text.split(/\r?\n/).map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim() !== "")
    .map(({ line, lineNumber }) => {
      try {
        const inputCoordinate = parseCoordinateLine(line, source);
        return {
          lineNumber,
          input: line,
          inputCoordinate,
          outputCoordinate: transformCoordinate(inputCoordinate, source, destination),
          status: "success" as const,
        };
      } catch (error) {
        return {
          lineNumber,
          input: line,
          status: "error" as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
}
