# WebGIS Tools

ブラウザだけで利用できるGISユーティリティ集です。トップページをダッシュボードとし、座標・測地、ベクタ処理、空間解析、データ確認、WebMapなどのツールを段階的に追加できる構成を目指します。座標変換、GISファイル情報確認、ベクターファイル変換を提供します。

## 使用技術

- Vite / React / TypeScript
- proj4（Proj4js）
- React Router
- Vitest
- @ngageoint/geopackage（GeoPackage / SQL.js WASM）
- shpjs / fflate（Shapefile読込 / ZIP処理）

座標値は外部へ送信せず、変換処理はブラウザ内で完結します。

## ベクター変換

`/vector-converter` でGeoJSON、KML、Shapefile ZIP、GeoPackageを相互変換します。ファイル内容から形式を判定し、GeoPackageまたは複数Shapefileを含むZIPでは、変換するVectorレイヤーを1つ選択できます。入力と同じ形式は出力候補から除外されます。

- GeoJSON / KML出力はWGS84（経度・緯度）へ変換
- Shapefile / GeoPackage出力は入力CRSを原則維持
- 座標変換が必要なのにCRSを判定できない場合だけ、入力EPSGの指定が必要
- Shapefile出力は`.shp`、`.shx`、`.dbf`、`.cpg`と、CRS判明時の`.prj`をZIP化
- GeoPackageはVector Feature Tableのみを対象とし、1回につき1レイヤーを出力
- 最大入力サイズは100MB（Shapefile ZIPは展開後250MBまで）

処理とダウンロードはブラウザ内で完結し、入力ファイルをサーバーへ送信しません。GeoPackage機能を初めて使うときだけ、約1.10MBのライブラリと約631KBのWASM assetを遅延読込します。

制約として、Raster、GeoPackageのTile・Style・拡張、全レイヤー一括変換、Geometry編集には対応しません。Shapefileは1レイヤー1系統のGeometry、属性名10文字、DBF型などの制約があり、変更や情報損失の可能性を画面に警告します。GeometryCollectionはGeoJSON / KML / GeoPackageで扱えますが、Shapefile出力には対応しません。M値は判別できない形式があるため完全対応ではありません。

## GIS Info

`/gis-info` でGISファイルをドロップまたは選択すると、Vector / Rasterを自動判定して基本情報を表示します。解析ボタンはなく、ファイル受付後に自動解析します。処理はブラウザ内で完結し、ファイルを外部サーバーへ送信しません。

### 対応形式

| 種別 | 形式 | 補足 |
|---|---|---|
| Vector | GeoJSON（`.geojson` / `.json`） | FeatureCollection、Feature、各Geometry、GeometryCollection |
| Vector | KML（`.kml`） | Placemarkと基本Geometry。仕様に従いWGS84として表示 |
| Raster | GeoTIFF（`.tif` / `.tiff`） | Classic TIFFのIFD、GeoKey、ジオリファレンスを解析 |
| Raster | COG | GeoTIFFとしてメタデータを解析。COG準拠性そのものは検証しない |

形式判定は拡張子だけではなく、JSON/XMLの先頭内容またはTIFFシグネチャを優先します。Shapefile（ZIP・複数関連ファイルの同時ドロップを含む）とGeoPackageは第一版では未対応です。`.shp`、`.shx`、`.dbf`、`.prj` の関連付けやSQLite読み取りには追加実装・依存関係の検討が必要なため、推測による不完全な解析は行いません。

### 表示内容

- 共通: ファイル名、形式、Vector / Raster、サイズ、CRS、EPSG、座標単位、Geographic / Projected、Bounding Box
- Vector: Geometry Type、Feature数、Z座標の有無、M座標の取得可否、属性フィールド名と推定型
- Raster: Width、Height、バンド数、Resolution、Data Type、NoData、Compression、Overviewの有無

GeoJSONに`crs`プロパティがある場合はその記載を優先します。`OGC:CRS84`、`CRS84`、OGC URN表記はWGS84 / OGC:CRS84へ正規化し、EPSGコードではないため「EPSG:4326 相当」と表示します。`crs`がない場合もGeoJSON標準に基づくWGS84・EPSG:4326相当として、推定であることを判定根拠へ表示します。未知の明示CRSはWGS84と推定しません。

CRS定義上の軸順序とファイル内の座標配列順序は別に保持します。OGC:CRS84は経度・緯度、EPSG:4326の定義軸順は緯度・経度ですが、GeoJSONの実データ配列は経度・緯度です。KMLは仕様上のWGS84です。GeoTIFFはGeoKey内のProjectedCSType / GeographicType、単位、Citationを読みます。GeoTIFF内にCRS情報がない場合は推測せず「不明」と表示します。

GeoTIFFはファイル全体ではなく、ヘッダー・IFD・参照されるメタデータ範囲を`Blob.slice()`で読み、全画素走査を行いません。Min / Max / Mean / StdDevなどの統計、地図・画像プレビュー、ファイル変換・出力は行いません。GeoJSONとKMLは構造・範囲・属性確認のためテキスト全体を読み込みます。

現在の制限事項は、BigTIFF、GCPやRPCだけで定義された特殊なジオリファレンス、KMLの高度な拡張要素、GeoJSONのM座標判別に未対応であることです。将来はShapefile / GeoPackage、BigTIFF、統計の任意実行、Map Preview、解析結果のコピー・JSON出力を解析層の拡張として追加できます。

## 起動と検証

Node.js 20.19以上または22.12以上を想定しています。

```bash
npm install
npm run dev
npm test
npm run build
```

GitHub Pages向け（リポジトリ `onochin/Web-GisTool`）には次を使用します。

```bash
npm run build -- --mode github-pages
```

`main`ブランチへpushすると、`.github/workflows/deploy.yml`がビルドした`dist`をGitHub Pagesへ自動デプロイします。`public/404.html`は、React Routerの直接URLをGitHub PagesからSPAへ戻すためのフォールバックです。リポジトリ名を変える場合は`vite.config.ts`の`base`（現在は`/Web-GisTool/`）も変更してください。

## 座標変換ツール

`/coordinate` でファイルをドロップし、登録済みの任意の変換元CRSから変換先CRSへ座標を変換できます。画面は左側に現在の座標系・変換後の座標系・出力、右側にファイルドロップ領域を配置しています。

- プリセット選択とEPSGコード直接指定（`4326` / `EPSG:4326`）
- GeoJSON（`.geojson` / `.json`）、KML（`.kml`）、CSV/TSV（`.csv` / `.tsv` / `.txt`）
- ドラッグ＆ドロップまたはファイル選択
- 最大ファイルサイズ20MB
- CRSに応じた単位と軸説明
- 「変換を実行してダウンロード」による変換済みファイルの自動保存

GeoJSONは全Geometry種別とGeometryCollectionに対応し、座標を一般的な `[x, y]` 順として扱います。高さなど3番目以降の値は変換せず維持します。投影CRSのGeoJSONには変換先EPSGを`crs`プロパティとして付加します。

CSV/TSVは簡易形式として先頭2列を座標列とし、選択中CRSの画面軸順で扱います。先頭の非数値行はヘッダーとして維持します。引用符内の区切り文字を解釈する複雑なCSVパーサーは第一版では実装していません。

KMLは仕様上WGS84固定のため変換元を自動的にEPSG:4326とし、Point・LineString・Polygon・MultiGeometryをGeoJSONへ変換して出力します。高さ、標高、ジオイド、セミ・ダイナミック補正、PatchJGDは扱いません。

## 対応CRS

| CRS | EPSG | UI上の順序 | 単位 |
|---|---:|---|---|
| WGS 84 | 4326 | 緯度, 経度 | degree |
| JGD2011 | 6668 | 緯度, 経度 | degree |
| JGD2000 | 4612 | 緯度, 経度 | degree |
| Web Mercator | 3857 | X (Easting), Y (Northing) | m |
| JGD2011 / 平面直角座標 I～XIX系 | 6669～6687 | X (Northing), Y (Easting) | m |
| JGD2000 / 平面直角座標 I～XIX系 | 2443～2461 | X (Northing), Y (Easting) | m |

未登録のEPSGコードは推測せず、明示的なエラーにします。第一版は外部のCRS定義サービスへ問い合わせません。

## CRS定義と内部座標順序

- `src/lib/crs/types.ts`: CRS情報モデル
- `src/lib/crs/definitions.ts`: proj4定義を含む全登録CRSの一元管理
- `src/lib/crs/resolver.ts`: 入力コードの正規化と解決
- `src/lib/coordinates/normalize.ts`: UI順と内部順の変換境界
- `src/lib/coordinates/transform.ts`: 共通変換エンジン

内部座標は常に `[x, y]`、すなわち地理座標では `[longitude, latitude]`、投影座標では `[easting, northing]` です。UIとの入出力時だけ `normalize.ts` が順序を変換します。

日本の平面直角座標は **X＝北方向（Northing）、Y＝東方向（Easting）** です。一般的な投影座標のx/yやProj4js内部順とは逆になるため、Reactコンポーネントではなく正規化層の一箇所だけで入れ替えます。この軸定義とI～XIX系の原点は、[国土地理院「平面直角座標系」](https://www.gsi.go.jp/LAW/heimencho)および[EPSG DatasetのCRS定義（例: EPSG:6687）](https://epsg.org/crs_6687/JGD2011-Japan-Plane-Rectangular-CS-XIX.html)に基づきます。

JGD2000とJGD2011間の地殻変動補正（PatchJGD、セミ・ダイナミック補正）は行いません。Proj4jsで表現できる楕円体・投影定義に基づく座標変換であり、測量成果の時点補正が必要な用途には使用しないでください。

## テストデータ

平面直角II系の既知値は、[国土地理院「平面直角座標への変換」No.2](https://www.gsi.go.jp/common/000260486.pdf)を使用しています。さらにローカルのEPSG databaseを参照するPROJの `projinfo` と `cs2cs` で定義・変換値を独立照合しています。`cs2cs` がEPSGコード指定時に公式軸順を適用することは[PROJ公式ドキュメント](https://proj.org/en/stable/apps/cs2cs.html)に記載されています。

テストはWGS84/Web Mercator、WGS84/JGD2011、WGS84/平面直角座標の双方向・往復、X/Y、resolverに加え、ファイル形式判定、GeoJSONのx/y・高さ維持、CSVのヘッダー・UI軸順・不正行を対象にします。

## 拡張方法

### CRSを追加する

1. `src/lib/crs/definitions.ts` に `CrsDefinition` を追加する。
2. 信頼できる一次資料からproj4定義、単位、UI軸順を確認する。
3. 既知値と往復変換のテストを追加する。

UIは `CRS_PRESETS` から自動生成され、直接 `proj4.defs()` を操作しません。将来、resolverの背後に外部定義サービスを追加できます。

### GISツールを追加する

1. 独立したページまたは `src/tools/` 配下の機能を追加する。
2. `src/config/tools.ts` に名称、説明、カテゴリ、ルート等を登録する。
3. `src/App.tsx` にルートを追加する。

Dashboardは設定データからカードを生成するため、ツールカード本体の変更は不要です。共通GIS処理は `src/lib/` に置き、React UIに依存させない方針です。
