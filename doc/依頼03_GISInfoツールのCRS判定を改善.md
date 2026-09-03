GIS Info ツールのCRS判定を改善してください。

現在、QGISで EPSG:2450 のベクターデータを WGS84 に変換して GeoJSON として出力したファイルを GIS Info に読み込むと、座標系情報が以下のようになります。

CRS:
urn:ogc:def:crs:OGC:1.3:CRS84

EPSG:
不明

座標単位:
不明

種類:
不明

判定根拠:
GeoJSON crsプロパティ

このGeoJSONは、WGS84のみ対応のWebMapでは正常な位置に表示されています。

原因として、GeoJSON側では WGS84 が EPSG:4326 ではなく OGC:CRS84 として記録されている一方、現在のGIS Info側が CRS84 を認識できていないと考えています。

以下の対応をお願いします。

# 1. CRS84を認識する

以下のような表記を認識してください。

- OGC:CRS84
- CRS84
- urn:ogc:def:crs:OGC:1.3:CRS84
- urn:ogc:def:crs:OGC::CRS84

表記揺れがあっても、CRS84として判定できるようにしてください。

---

# 2. CRS84の表示

CRS84を検出した場合、GIS Infoでは以下のように表示してください。

CRS:
WGS84 / OGC:CRS84

EPSG:
EPSG:4326 相当

座標単位:
degree

種類:
地理座標系

座標順序:
経度, 緯度

判定根拠:
GeoJSON crsプロパティ（OGC:CRS84）

CRS84自体はEPSGコードではないため、EPSG欄を単純に「EPSG:4326」と断定せず、
「EPSG:4326 相当」
という表示にしてください。

---

# 3. EPSG:4326との違いを内部で区別する

CRS84とEPSG:4326は、WGS84を使用する点では近いですが、座標軸順序の扱いが異なります。

GeoJSON / OGC:CRS84:
- longitude
- latitude
- 経度, 緯度

EPSG定義上のEPSG:4326:
- latitude
- longitude

一般的なGeoJSON座標配列は、

[x, y] = [longitude, latitude]

として扱います。

したがって、

「WGS84だからすべて同一の軸順序」

という実装にはしないでください。

CRSの意味と、実データの座標配列順序を分離して管理してください。

---

# 4. CRS情報がないGeoJSONへの対応

GeoJSONにはCRS情報が明示されていないケースもあります。

その場合も「不明」で終わらせず、GeoJSONとして読み込まれた場合は、標準的なGeoJSONの扱いに基づいて、

CRS:
WGS84

EPSG:
EPSG:4326 相当

座標単位:
degree

種類:
地理座標系

座標順序:
経度, 緯度

判定根拠:
GeoJSON標準による推定

のように表示できるようにしてください。

ただし、ファイル内に明示的なCRS情報がある場合は、そちらを優先してください。

判定優先順位は概ね、

1. ファイル内に明示されたCRS
2. EPSGコード
3. OGC:CRS84等の既知CRS表記
4. GeoJSON標準に基づく推定

としてください。

---

# 5. 推測と明示情報を区別する

GIS Infoは今後、データのメタ情報を確認する用途で使用するため、

「ファイルに明示されている情報」

と

「ファイル形式から推定した情報」

を区別できるようにしてください。

例えば、

判定根拠:
- GeoJSON crsプロパティ
- GeoJSON標準による推定
- EPSGコード
- WKT
- GDALによる判定

などを表示できる構造にしてください。

---

# 6. CRS判定ロジックを共通化する

今回の対応をGeoJSONコンポーネント内だけにハードコードしないでください。

CRS判定処理は共通モジュールとして管理してください。

例えば、

src/
  lib/
    crs/
      detectCrs.ts
      normalizeCrs.ts
      crsAliases.ts

などです。

実際の構成は既存プロジェクトに合わせて変更して構いません。

今後、

- KML
- GeoPackage
- Shapefile
- GeoTIFF
- その他Vector/Raster

のCRS判定でも同じ仕組みを利用できるようにしてください。

---

# 7. CRS aliasの考え方

CRSの表記揺れに対応できるようにしてください。

例えば、

OGC:CRS84
urn:ogc:def:crs:OGC:1.3:CRS84

のような文字列を、それぞれ個別のif文で処理するのではなく、

CRS alias
↓
正規化
↓
内部CRS情報

という流れを検討してください。

将来、EPSGやESRI等の別表記が増えても追加しやすい構造にしてください。

---

# 8. テスト

最低限、以下のテストを追加してください。

1.
crs:
urn:ogc:def:crs:OGC:1.3:CRS84

→ CRS84として判定される

2.
OGC:CRS84

→ CRS84として判定される

3.
CRS情報なしのGeoJSON

→ GeoJSON標準によるWGS84として推定される

4.
EPSG:4326が明示されたデータ

→ EPSG:4326として判定される

5.
CRS84とEPSG:4326の座標軸情報を混同しない

6.
未知のCRS文字列

→ 勝手にWGS84等へ変換せず、「不明」として扱う

---

# 9. 今回変更しないこと

今回はGIS Info全体のUIを大きく変更しないでください。

現在の、

- 右側：ファイルドロップ
- 左側：情報表示

というレイアウトは維持してください。

Vectorのフィールド情報表示など、現在正常に動いている機能も壊さないでください。

今回の主目的は、

「GeoJSONにおけるCRS84 / WGS84の判定改善」

です。

---

# 10. 完了確認

修正後は、

1. lint
2. 型チェック
3. 単体テスト
4. build

を実行してください。

また、今回問題となったGeoJSONを使って、画面上で

CRS:
WGS84 / OGC:CRS84

EPSG:
EPSG:4326 相当

座標単位:
degree

種類:
地理座標系

座標順序:
経度, 緯度

のように認識されることを確認してください。

最後に、

- 原因
- 修正内容
- CRS正規化の仕組み
- テスト結果
- build結果

を簡潔に報告してください。
