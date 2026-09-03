declare module "shpjs" {
  export function parseShp(shp: ArrayBuffer | ArrayBufferView, prj?: string): unknown[];
  export function parseDbf(dbf: ArrayBuffer | ArrayBufferView, cpg?: string): Record<string, unknown>[];
}

