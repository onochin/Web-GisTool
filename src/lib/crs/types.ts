export type CrsType = "geographic" | "projected";
export type CoordinateUnit = "degree" | "metre";
export type AxisOrder = "latitudeLongitude" | "eastingNorthing" | "northingEasting";
export type PresetCategory = "global" | "japan-geographic" | "japan-plane-rectangular";

export type CrsDefinition = {
  code: `EPSG:${number}`;
  epsg: number;
  name: string;
  shortName: string;
  type: CrsType;
  unit: CoordinateUnit;
  /** UIで採用する座標順序。proj4内部は常にx,y。 */
  axisOrder: AxisOrder;
  category: PresetCategory;
  proj4: string;
  planeRectangularZone?: number;
};

export type Coordinate = readonly [number, number];
