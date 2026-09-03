# webgis-tools 引き継ぎ資料

最終更新: 2026-09-03

今回の更新: `doc/依頼03_座標変換ツールの修正.md` に基づくGIS InfoのCRS84判定改善を反映。

## 1. 現在の状態

Webブラウザ内でGISファイルの座標変換と基本情報確認を行うReactアプリを実装済みです。独自バックエンドはなく、入力ファイルを外部へ送信しません。

- `/`: WebGIS Tools Dashboard
- `/coordinate`: ファイル用座標変換ツール
- `/gis-info`: Vector / Raster基本情報確認ツール
- 変換画面は左側に「現在の座標系」「変換後の座標系」「出力」、右側にファイルドロップ領域を配置
- 「変換を実行してダウンロード」で変換とダウンロードを連続実行
- 元ファイルは上書きしない
- 出力名は原則 `<元ファイル名>_converted.<拡張子>`
- 保存先はブラウザのダウンロード設定に従う

参考にしたUI画像は `ref/tool_座標変換UI_image.png` です。

## 2. 技術構成

- Vite 7
- React 19
- TypeScript 5.8
- React Router 7
- Proj4js 2.19
- Vitest 3

主要コマンド:

```bash
npm run dev
npm test
npm run build
npm run build:pages
```

依存パッケージは導入済みです。再構築には `package-lock.json` を使い、必要に応じて次を使用してください。

```bash
npm ci --ignore-scripts --no-audit --no-fund
```

## 3. 対応CRS

登録CRSは合計42件です。

| CRS | EPSG |
|---|---:|
| WGS 84 | 4326 |
| Web Mercator | 3857 |
| JGD2011 | 6668 |
| JGD2011 / 平面直角座標 I～XIX系 | 6669～6687 |
| JGD2000 | 4612 |
| JGD2000 / 平面直角座標 I～XIX系 | 2443～2461 |

ユーザーが実際に使用したEPSG:2450は `JGD2000 / 平面直角座標 VIII系` です。

平面直角座標系の選択肢には、例として次のようにEPSG番号を併記します。

```text
JGD2000 / 平面直角座標 VIII系 / EPSG:2450
JGD2011 / 平面直角座標 IX系 / EPSG:6677
```

未登録EPSGは推測せず、resolverがエラーを返します。

## 4. 座標軸の重要仕様

Proj4jsへ渡す内部座標は常に次の順序です。

- 地理座標: `[longitude, latitude]`
- 投影座標: `[easting, northing]`

日本の平面直角座標を画面やCSVで扱う場合は次の順序です。

- `X = Northing（北方向）`
- `Y = Easting（東方向）`

この入れ替えは `src/lib/coordinates/normalize.ts` に集約されています。Reactコンポーネントへ個別の入れ替え処理を追加しないでください。

GeoJSONはGIS標準の `[x, y]` 順として扱うため、平面直角座標でも `[Easting, Northing]` です。一方、CSV/TSVは先頭2列を選択中CRSのUI順として扱うため、平面直角座標では `[X=Northing, Y=Easting]` です。

## 5. ファイル変換仕様

### GeoJSON

- `.geojson` / `.json`
- Feature、FeatureCollection、全Geometry種別、GeometryCollectionに対応
- 3番目以降の座標値（高さ等）は変換せず維持
- EPSG:4326出力では旧`crs`プロパティを削除
- 投影CRS出力では変換先EPSGを`crs`プロパティへ付加

### CSV / TSV

- `.csv` / `.tsv` / `.txt`
- 先頭2列を座標として変換
- タブを含む場合はタブ区切り、それ以外はカンマ区切り
- データより前にある非数値行をヘッダーとして維持
- 追加列はそのまま維持
- 引用符内のカンマを解釈する完全なCSVパーサーではない

### KML

- `.kml`
- KMLのCRSは仕様上WGS84固定なので、選択時に変換元をEPSG:4326へ固定
- Point、LineString、Polygon、MultiGeometryに対応
- 投影座標をKMLとして出力できないため、変換結果はGeoJSON
- PlacemarkのnameとdescriptionをGeoJSON propertiesへ維持

全形式で最大ファイルサイズは20MBです。

## 5-2. GIS Info仕様

- Vector: GeoJSON、KML
- Raster: GeoTIFF、COG（GeoTIFFとして解析し、COG準拠性は検証しない）
- 内容の先頭またはTIFFシグネチャを優先して形式とVector / Rasterを自動判定
- ファイル受付後に自動解析し、CRS、EPSG、単位、データ範囲を表示
- VectorはGeometry、Feature数、Z/M、属性フィールド型を表示
- RasterはWidth、Height、バンド数、Resolution、Data Type、NoData、Compression、Overviewを表示
- GeoJSONは`crs`記載を優先し、OGC:CRS84の短縮・URN表記をWGS84 / OGC:CRS84、EPSG:4326相当として表示
- `crs`がないGeoJSONは標準に基づく推定と明示し、未知の明示CRSはWGS84と推定しない
- CRS定義軸順とファイル内配列順を分離（CRS84は経度・緯度、EPSG:4326定義は緯度・経度、GeoJSON配列は経度・緯度）
- KMLは仕様上のWGS84を判定根拠とともに表示
- GeoTIFFはGeoKeyを読み、CRSがなければ推測せず「不明」と表示
- 全画素統計、プレビュー、変換・出力は行わない
- Shapefile、GeoPackage、BigTIFFは未対応

GeoTIFFは`Blob.slice()`を使い、IFDと必要なメタデータ範囲だけを読み込みます。GeoJSONとKMLは範囲・属性解析のためテキスト全体を読み込みます。

### CRS84正規化の重要仕様

次の表記はすべて内部で`OGC:CRS84`へ正規化します。

- `OGC:CRS84`
- `CRS84`
- `urn:ogc:def:crs:OGC:1.3:CRS84`
- `urn:ogc:def:crs:OGC::CRS84`

画面表示は次のとおりです。

```text
CRS:       WGS84 / OGC:CRS84
EPSG:      EPSG:4326 相当
座標単位: degree
種類:      地理座標系
座標順序: 経度, 緯度
判定根拠: GeoJSON crsプロパティ（OGC:CRS84）
```

CRS84はEPSGコードではないため、`epsg`は`null`、`equivalentEpsg`は`4326`として保持します。明示されたEPSG:4326は`epsg: 4326`として保持し、両者を同一扱いにしないでください。

ファイル内の明示CRSを最優先し、その文字列を「既知alias → EPSG表記 → 未知の明示CRS」の順で評価します。明示CRSがない場合だけファイル形式の規約を使います。未知の明示CRSがある場合はGeoJSON標準による推定へフォールバックせず、不明として扱います。

`axisOrder`はCRS定義上の軸順、`dataAxisOrder`はファイル内配列の順序です。EPSG:4326では前者が緯度・経度、GeoJSONでは後者が経度・緯度となります。

## 6. 主なファイル

| ファイル | 責務 |
|---|---|
| `src/pages/CoordinateConverter/CoordinateConverter.tsx` | ドロップ、CRS設定、変換実行、自動ダウンロード |
| `src/lib/files/coordinateFile.ts` | 形式判定、GeoJSON/KML/CSV変換 |
| `src/lib/crs/definitions.ts` | 全CRS定義と平面直角I～XIX系生成 |
| `src/lib/crs/resolver.ts` | EPSG入力の正規化と登録確認 |
| `src/lib/coordinates/transform.ts` | 共通Proj4js変換エンジン |
| `src/lib/coordinates/normalize.ts` | UI順と内部順の変換 |
| `src/pages/GisInfo/GisInfo.tsx` | GIS InfoのドロップUIと情報一覧 |
| `src/lib/gis/analyze.ts` | GIS形式判定と解析処理の振り分け |
| `src/lib/gis/vector.ts` | GeoJSON / KMLメタデータ解析 |
| `src/lib/gis/geotiff.ts` | GeoTIFFのIFD / GeoKey / 範囲解析 |
| `src/lib/gis/types.ts` | 再利用可能なGIS解析結果型 |
| `src/lib/crs/metadata.ts` | CRS alias正規化、明示情報・形式推定、CRS軸順・データ順の分離 |
| `src/config/tools.ts` | Dashboardのツール定義 |
| `src/styles.css` | Dashboardと座標変換画面のスタイル |
| `public/404.html` | GitHub Pages用SPAフォールバック |

`src/tools/coordinate/CrsSelector.tsx`、`src/lib/coordinates/parser.ts`、`formatter.ts` は、初期の単点・複数点UI用に作成した再利用可能コードです。現在のファイル変換画面からは使用していません。削除する場合は、将来の単点変換再追加予定を確認してください。

## 7. テスト・検証状態

直近の結果:

```text
Test Files  4 passed (4)
Tests       41 passed (41)
vite build  success
```

テストファイル:

- `src/lib/coordinates/coordinates.test.ts`
- `src/lib/files/coordinateFile.test.ts`
- `src/lib/gis/gisInfo.test.ts`
- `src/lib/crs/metadata.test.ts`

確認対象:

- EPSG resolverと未登録EPSG
- WGS84 / Web Mercator / JGD2011 / 平面直角座標の変換・往復
- 国土地理院の既知値による平面直角II系のX/Y
- EPSG:2450の原点、軸順、往復
- GeoJSONのx/y順と高さ維持
- CSV/TSVのUI軸順、ヘッダー、不正行
- Vector / Rasterとファイル形式の判定
- GeoJSONの基本情報、属性型、CRS規約、Bounding Box
- CRS84の短縮表記・URN表記、EPSG:4326との軸順分離、未知CRSの非推定
- GeoTIFFのサイズ、バンド、Data Type、NoData、CRSあり・なし、Bounding Box
- 不正ファイルと未対応形式

KML変換はブラウザの `DOMParser` を使用します。現在のVitest環境はNodeのため、KMLの自動テストは未追加です。次にテストを強化する場合は、ブラウザテストを追加するか、XML部分をDOM非依存に分離してください。

## 8. 既知の制約・注意点

- JGD2000とJGD2011間のPatchJGD、セミ・ダイナミック補正、地殻変動補正は行わない
- 高さ、標高、ジオイド高の変換は行わない
- EPSG定義の外部取得は行わず、登録済み42 CRSだけを使用
- CSVはRFC 4180完全準拠ではない
- 座標変換、GeoJSON、KMLはファイルをブラウザメモリへ一括読み込みする
- GIS InfoはShapefile、GeoPackage、BigTIFF、GCP/RPCだけのジオリファレンスに未対応
- KMLの高度な拡張要素とGeoJSONのM座標判別に未対応
- 保存場所の指定はアプリではなくブラウザ設定に委ねる
- 「変換を実行してダウンロード」時に同名ファイルがある場合の扱いはブラウザ依存

## 9. 今後の拡張候補

- WGS84 / UTM（北半球EPSG:32601～32660、南半球EPSG:32701～32760）
- UTMを長い一覧にせず「ゾーン番号」「北半球・南半球」で選ぶUI
- 引用符・改行を含むCSVへの対応
- KMLのExtendedDataや追加Geometry情報の維持
- 大容量ファイル向けストリーム処理またはWeb Worker
- ブラウザを使ったドラッグ＆ドロップ／ダウンロードのE2Eテスト

CRSを追加する場合は、`definitions.ts`へ定義を追加し、一次資料に基づく既知値テストと軸順テストを必ず追加してください。

## 10. GitHub Pages

Pages用ビルド:

```bash
npm run build -- --mode github-pages
```

GitHubリポジトリは`onochin/Web-GisTool`です。`main`ブランチへのpushで`.github/workflows/deploy.yml`が`dist`をGitHub Pagesへ自動デプロイします。Pages Sourceは「GitHub Actions」を使用します。

`vite.config.ts`のPages用baseは大文字小文字を含めて`/Web-GisTool/`です。`public/404.html`と`index.html`の退避・復元処理により、`/coordinate`と`/gis-info`への直接アクセスをBrowserRouterへ戻します。リポジトリ名を変更する場合はbaseも合わせて変更してください。

`.gitignore`では画像を原則除外し、公開サイトで使う`public/`配下と`src/assets/`配下の画像だけを例外としてGit管理します。参考画像は`ref/`に置くと除外対象のままです。
