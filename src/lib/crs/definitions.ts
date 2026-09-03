import type { CrsDefinition } from "./types";

const geographic = (
  epsg: number,
  name: string,
  shortName: string,
  ellipsoid: "WGS84" | "GRS80",
  category: CrsDefinition["category"],
): CrsDefinition => ({
  code: `EPSG:${epsg}`,
  epsg,
  name,
  shortName,
  type: "geographic",
  unit: "degree",
  axisOrder: "latitudeLongitude",
  category,
  proj4: `+proj=longlat +ellps=${ellipsoid} +no_defs +type=crs`,
});

const zoneOrigins = [
  [1, 33, 129.5], [2, 33, 131], [3, 36, 132 + 10 / 60],
  [4, 33, 133.5], [5, 36, 134 + 20 / 60], [6, 36, 136],
  [7, 36, 137 + 10 / 60], [8, 36, 138.5], [9, 36, 139 + 50 / 60],
  [10, 40, 140 + 50 / 60], [11, 44, 140.25], [12, 44, 142.25],
  [13, 44, 144.25], [14, 26, 142], [15, 26, 127.5],
  [16, 26, 124], [17, 26, 131], [18, 20, 136], [19, 26, 154],
] as const;

const romanZones = [
  "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
  "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX",
] as const;

const createPlaneRectangularDefinitions = (
  datumName: "JGD2000" | "JGD2011",
  firstEpsg: 2443 | 6669,
): CrsDefinition[] => zoneOrigins.map(
  ([zone, latitudeOfOrigin, centralMeridian], index) => {
    const epsg = firstEpsg + index;
    const roman = romanZones[index];
    return {
      code: `EPSG:${epsg}`,
      epsg,
      name: `${datumName} / 平面直角座標 ${roman}系 / EPSG:${epsg}`,
      shortName: `${datumName} / 平面直角 ${roman}系`,
      type: "projected",
      unit: "metre",
      axisOrder: "northingEasting",
      category: "japan-plane-rectangular",
      proj4: `+proj=tmerc +lat_0=${latitudeOfOrigin} +lon_0=${centralMeridian} +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs`,
      planeRectangularZone: zone,
    } satisfies CrsDefinition;
  },
);

const jgd2011PlaneRectangularDefinitions = createPlaneRectangularDefinitions("JGD2011", 6669);
const jgd2000PlaneRectangularDefinitions = createPlaneRectangularDefinitions("JGD2000", 2443);

export const CRS_DEFINITIONS: readonly CrsDefinition[] = [
  geographic(4326, "WGS 84 / EPSG:4326", "WGS84", "WGS84", "global"),
  geographic(6668, "JGD2011 / EPSG:6668", "JGD2011", "GRS80", "japan-geographic"),
  geographic(4612, "JGD2000 / EPSG:4612", "JGD2000", "GRS80", "japan-geographic"),
  {
    code: "EPSG:3857",
    epsg: 3857,
    name: "WGS 84 / Pseudo-Mercator / EPSG:3857",
    shortName: "Web Mercator",
    type: "projected",
    unit: "metre",
    axisOrder: "eastingNorthing",
    category: "global",
    proj4: "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs +type=crs",
  },
  ...jgd2011PlaneRectangularDefinitions,
  ...jgd2000PlaneRectangularDefinitions,
];

export const CRS_BY_CODE = new Map(CRS_DEFINITIONS.map((crs) => [crs.code, crs]));
