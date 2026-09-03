import { type DragEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { analyzeGisFile } from "../../lib/gis/analyze";
import type { Bounds, GisMetadata } from "../../lib/gis/types";
import type { MetadataAxisOrder } from "../../lib/crs/metadata";

function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function displayValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "不明";
  return String(value);
}

function coordinate(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumSignificantDigits: 12 });
}

function axisOrderLabel(order: MetadataAxisOrder | null): string | null {
  if (order === "longitudeLatitude") return "経度, 緯度";
  if (order === "latitudeLongitude") return "緯度, 経度";
  if (order === "eastingNorthing") return "X（Easting）, Y（Northing）";
  if (order === "northingEasting") return "X（Northing）, Y（Easting）";
  if (order === "xy") return "x, y";
  return null;
}

function crsTypeLabel(type: GisMetadata["crs"]["type"]): string | null {
  if (type === "geographic") return "地理座標系";
  if (type === "projected") return "投影座標系";
  return null;
}

function InfoRows({ rows }: { rows: Array<[string, string | number | null | undefined]> }) {
  return <dl className="gis-info-rows">{rows.map(([label, value]) => (
    <div key={label}><dt>{label}</dt><dd>{displayValue(value)}</dd></div>
  ))}</dl>;
}

function BoundsRows({ bounds }: { bounds: Bounds | null }) {
  return <InfoRows rows={[
    ["xmin", bounds ? coordinate(bounds.xmin) : null],
    ["ymin", bounds ? coordinate(bounds.ymin) : null],
    ["xmax", bounds ? coordinate(bounds.xmax) : null],
    ["ymax", bounds ? coordinate(bounds.ymax) : null],
  ]} />;
}

function MetadataPanel({ metadata }: { metadata: GisMetadata }) {
  const vector = metadata.vector;
  const raster = metadata.raster;
  const epsgLabel = metadata.crs.epsg
    ? `EPSG:${metadata.crs.epsg}`
    : metadata.crs.equivalentEpsg ? `EPSG:${metadata.crs.equivalentEpsg} 相当` : null;
  const dataAxisOrder = axisOrderLabel(metadata.crs.dataAxisOrder);
  const crsAxisOrder = axisOrderLabel(metadata.crs.axisOrder);
  return <div className="gis-metadata">
    <div className={`gis-kind-badge ${metadata.kind}`}>{metadata.kind.toUpperCase()}</div>
    <strong className="gis-format-name">{metadata.format}</strong>

    <section className="gis-info-section">
      <h2>ファイル</h2>
      <InfoRows rows={[["ファイル名", metadata.fileName], ["サイズ", humanFileSize(metadata.fileSize)], ["形式", metadata.format]]} />
    </section>
    <section className="gis-info-section">
      <h2>座標系</h2>
      <InfoRows rows={[
        ["CRS", metadata.crs.name],
        ["EPSG", epsgLabel],
        ["座標単位", metadata.crs.unit],
        ["種類", crsTypeLabel(metadata.crs.type)],
        ["座標順序", dataAxisOrder],
        ...(crsAxisOrder && dataAxisOrder && crsAxisOrder !== dataAxisOrder
          ? [["CRS定義の軸順序", crsAxisOrder] as [string, string]]
          : []),
        ["判定根拠", metadata.crs.source],
      ]} />
    </section>
    <section className="gis-info-section">
      <h2>範囲</h2>
      <BoundsRows bounds={metadata.bounds} />
      <p className="axis-guidance">ファイル内の一般的な座標順に従い、X（東西方向）・Y（南北方向）で表示します。</p>
    </section>

    {vector && <>
      <section className="gis-info-section">
        <h2>ベクタ</h2>
        <InfoRows rows={[
          ["Geometry", vector.geometryType],
          ["Geometry種類", vector.geometryType === "Mixed" ? vector.geometryTypes.join(", ") : null],
          ["Feature数", vector.featureCount.toLocaleString()],
          ["Z座標", vector.hasZ ? "あり" : "なし"],
          ["M座標", vector.hasM === null ? "取得不可" : vector.hasM ? "あり" : "なし"],
        ]} />
      </section>
      <section className="gis-info-section">
        <h2>属性</h2>
        {vector.fields.length > 0 ? <div className="gis-field-table-wrap"><table className="gis-field-table">
          <thead><tr><th>フィールド</th><th>型</th></tr></thead>
          <tbody>{vector.fields.map((field) => <tr key={field.name}><td>{field.name}</td><td>{field.type}</td></tr>)}</tbody>
        </table></div> : <p className="gis-empty-value">属性フィールドはありません</p>}
      </section>
    </>}

    {raster && <section className="gis-info-section">
      <h2>ラスタ</h2>
      <InfoRows rows={[
        ["Width", raster.width.toLocaleString()],
        ["Height", raster.height.toLocaleString()],
        ["バンド数", raster.bands],
        ["Resolution", raster.resolution ? `${coordinate(raster.resolution[0])} × ${coordinate(raster.resolution[1])}` : null],
        ["Data Type", raster.dataType],
        ["NoData", raster.noData],
        ["Compression", raster.compression],
        ["Overview", raster.hasOverviews ? "あり" : "なし"],
      ]} />
    </section>}
  </div>;
}

export function GisInfo() {
  const inputRef = useRef<HTMLInputElement>(null);
  const sequenceRef = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<GisMetadata | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");

  const acceptFile = async (nextFile?: File) => {
    if (!nextFile) return;
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    setFile(nextFile);
    setMetadata(null);
    setError("");
    setIsAnalyzing(true);
    try {
      const result = await analyzeGisFile(nextFile);
      if (sequence === sequenceRef.current) setMetadata(result);
    } catch (caught) {
      if (sequence === sequenceRef.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (sequence === sequenceRef.current) setIsAnalyzing(false);
    }
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void acceptFile(event.dataTransfer.files[0]);
  };

  const clear = () => {
    sequenceRef.current += 1;
    setFile(null);
    setMetadata(null);
    setError("");
    setIsAnalyzing(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return <div className="page file-converter-page gis-info-page">
    <nav className="breadcrumb" aria-label="パンくず"><Link to="/">Dashboard</Link><span>/</span><span>GIS Info</span></nav>
    <header className="simple-page-header">
      <h1>GIS Info</h1>
      <p>Vector / Rasterの基本情報をブラウザで確認します。ファイルが外部へ送信されることはありません。</p>
    </header>

    <div className="gis-info-shell">
      <section className="gis-info-panel" aria-live="polite">
        {isAnalyzing && <div className="gis-info-state"><span className="analysis-spinner" aria-hidden="true" /><h2>解析中...</h2><p>{file?.name}</p></div>}
        {!isAnalyzing && error && <div className="gis-info-state error-state"><span aria-hidden="true">!</span><h2>解析できませんでした</h2><p>{error}</p></div>}
        {!isAnalyzing && !error && metadata && <MetadataPanel metadata={metadata} />}
        {!isAnalyzing && !error && !metadata && <div className="gis-info-state"><span aria-hidden="true">ⓘ</span><h2>情報表示</h2><p>ファイルをドロップすると情報を表示します</p></div>}
      </section>

      <section className="gis-info-drop-column" aria-labelledby="gis-drop-title">
        <div className={`drop-zone ${isDragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false); }}
          onDrop={drop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
          role="button" tabIndex={0}>
          <input ref={inputRef} className="visually-hidden" type="file" accept=".geojson,.json,.kml,.tif,.tiff"
            onChange={(event) => void acceptFile(event.target.files?.[0])} />
          <span className="drop-icon" aria-hidden="true">{isAnalyzing ? "…" : file ? "✓" : "⇧"}</span>
          <h2 id="gis-drop-title">{file ? "ファイルを解析しました" : "ファイルをここにドロップ"}</h2>
          <p>{file ? "別のファイルもそのままドロップできます。" : "またはクリックしてファイルを選択"}</p>
          <span className="format-list">GeoJSON / KML / GeoTIFF / COG</span>
        </div>
        {file && <div className="selected-file-card">
          <span className="selected-file-icon" aria-hidden="true">▤</span>
          <div><strong>{file.name}</strong><span>{humanFileSize(file.size)}{metadata ? `・${metadata.format}` : ""}</span></div>
          <button type="button" onClick={clear} aria-label="選択ファイルを解除">×</button>
        </div>}
        <div className="file-guidance">
          <h3>対応形式</h3>
          <ul>
            <li>Vector: GeoJSON / KML</li>
            <li>Raster: GeoTIFF / COG（GeoTIFFとして解析）</li>
            <li>統計計算・プレビュー・ファイル出力は行いません。</li>
          </ul>
        </div>
      </section>
    </div>
  </div>;
}
