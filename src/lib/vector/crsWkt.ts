import { CRS_BY_CODE } from "../crs/definitions";

export function epsgFromWkt(wkt: string): number | null {
  const matches = [...wkt.matchAll(/(?:AUTHORITY|ID)\s*\[\s*["']EPSG["']\s*,\s*["']?(\d+)/gi)];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}

function geographicWkt(epsg: number): string | null {
  if (epsg === 4326) return 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]';
  if (epsg === 4612) return 'GEOGCS["JGD2000",DATUM["Japanese_Geodetic_Datum_2000",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","6612"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4612"]]';
  if (epsg === 6668) return 'GEOGCS["JGD2011",DATUM["Japanese_Geodetic_Datum_2011",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","1128"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","6668"]]';
  return null;
}

function projParameter(definition: string, name: string): string {
  const match = definition.match(new RegExp(`\\+${name}=([^\\s]+)`));
  if (!match) throw new Error(`CRS定義から${name}を取得できません`);
  return match[1];
}

export function wktForEpsg(epsg: number): string | null {
  const geographic = geographicWkt(epsg);
  if (geographic) return geographic;
  if (epsg === 3857) return 'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]],PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AUTHORITY["EPSG","3857"]]';
  const crs = CRS_BY_CODE.get(`EPSG:${epsg}`);
  if (!crs?.planeRectangularZone) return null;
  const datumEpsg = epsg >= 6669 ? 6668 : 4612;
  const base = geographicWkt(datumEpsg);
  if (!base) return null;
  const latitude = projParameter(crs.proj4, "lat_0");
  const longitude = projParameter(crs.proj4, "lon_0");
  return `PROJCS["${crs.shortName}",${base},PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",${latitude}],PARAMETER["central_meridian",${longitude}],PARAMETER["scale_factor",0.9999],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AUTHORITY["EPSG","${epsg}"]]`;
}

