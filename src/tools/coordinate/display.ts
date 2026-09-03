import type { CrsDefinition } from "../../lib/crs/types";

export function coordinateFields(crs: CrsDefinition) {
  if (crs.type === "geographic") {
    return [
      { label: "緯度", shortLabel: "Lat", unit: "degree" },
      { label: "経度", shortLabel: "Lon", unit: "degree" },
    ] as const;
  }
  if (crs.axisOrder === "northingEasting") {
    return [
      { label: "X", shortLabel: "Northing", unit: "m" },
      { label: "Y", shortLabel: "Easting", unit: "m" },
    ] as const;
  }
  return [
    { label: "X", shortLabel: "Easting", unit: "m" },
    { label: "Y", shortLabel: "Northing", unit: "m" },
  ] as const;
}

export function axisDescription(crs: CrsDefinition): string {
  if (crs.type === "geographic") return "緯度・経度（内部処理: longitude, latitude）";
  if (crs.axisOrder === "northingEasting") return "X＝北方向（Northing） / Y＝東方向（Easting）";
  return "X＝Easting / Y＝Northing";
}
