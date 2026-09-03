export type ToolDefinition = {
  id: string;
  name: string;
  description: string;
  category: string;
  route: string;
  icon: string;
  enabled: boolean;
};

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: "coordinate-converter",
    name: "座標変換",
    description: "GeoJSON・KML・CSVをドロップし、ファイル内の座標系を変換します。",
    category: "座標・測地",
    route: "/coordinate",
    icon: "⇄",
    enabled: true,
  },
  {
    id: "gis-info",
    name: "GIS Info",
    description: "Vector・Rasterファイルをドロップし、基本情報やCRS、データ範囲を確認します。",
    category: "データ確認",
    route: "/gis-info",
    icon: "ⓘ",
    enabled: true,
  },
];
