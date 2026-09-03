import { type DragEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CRS_PRESETS } from "../../lib/crs/presets";
import { resolveCrs } from "../../lib/crs/resolver";
import type { CrsDefinition } from "../../lib/crs/types";
import {
  convertCoordinateFile,
  detectCoordinateFileFormat,
  type ConvertedFile,
} from "../../lib/files/coordinateFile";
import { axisDescription } from "../../tools/coordinate/display";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

type CrsControlProps = {
  id: string;
  title: string;
  value: CrsDefinition;
  onChange: (crs: CrsDefinition) => void;
  disabled?: boolean;
};

function CrsControl({ id, title, value, onChange, disabled = false }: CrsControlProps) {
  const [epsgInput, setEpsgInput] = useState(String(value.epsg));
  const [error, setError] = useState("");
  useEffect(() => { setEpsgInput(String(value.epsg)); setError(""); }, [value]);

  const change = (crs: CrsDefinition) => {
    setEpsgInput(String(crs.epsg));
    setError("");
    onChange(crs);
  };

  const applyEpsg = () => {
    try { change(resolveCrs(epsgInput)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };

  return (
    <section className="file-settings-card">
      <div className="file-card-heading">
        <span className="file-card-icon" aria-hidden="true">⌖</span>
        <div><p>{title}</p><strong>{value.shortName}</strong></div>
        <span className="epsg-pill">{value.code}</span>
      </div>
      <label htmlFor={`${id}-preset`}>座標系を選択</label>
      <select id={`${id}-preset`} value={value.code} disabled={disabled}
        onChange={(event) => change(resolveCrs(event.target.value))}>
        {CRS_PRESETS.map((crs) => <option value={crs.code} key={crs.code}>{crs.name}</option>)}
      </select>
      <label htmlFor={`${id}-epsg`}>EPSG番号</label>
      <div className="inline-field">
        <input id={`${id}-epsg`} value={epsgInput} disabled={disabled} inputMode="numeric"
          onChange={(event) => setEpsgInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") applyEpsg(); }} />
        <button type="button" className="button secondary" disabled={disabled} onClick={applyEpsg}>適用</button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <p className="compact-axis">{axisDescription(value)}・{value.unit === "degree" ? "度" : "m"}</p>
    </section>
  );
}

function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function CoordinateConverter() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<CrsDefinition>(() => resolveCrs(4326));
  const [destination, setDestination] = useState<CrsDefinition>(() => resolveCrs(6677));
  const [file, setFile] = useState<File | null>(null);
  const [convertedFile, setConvertedFile] = useState<ConvertedFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState("");

  const clearResult = () => { setConvertedFile(null); setError(""); };

  const acceptFile = (nextFile?: File) => {
    if (!nextFile) return;
    try {
      const format = detectCoordinateFileFormat(nextFile.name);
      if (nextFile.size > MAX_FILE_SIZE) throw new Error("ファイルサイズは20MB以下にしてください");
      setFile(nextFile);
      setConvertedFile(null);
      setError("");
      if (format === "kml") setSource(resolveCrs(4326));
    } catch (caught) {
      setFile(null);
      setConvertedFile(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    acceptFile(event.dataTransfer.files[0]);
  };

  const downloadConvertedFile = (output: ConvertedFile) => {
    const url = URL.createObjectURL(new Blob([output.content], { type: output.mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = output.fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const convert = async () => {
    if (!file) { setError("変換するファイルを選択してください"); return; }
    setIsConverting(true);
    setError("");
    try {
      const fileSource = detectCoordinateFileFormat(file.name) === "kml" ? resolveCrs(4326) : source;
      const output = convertCoordinateFile(await file.text(), file.name, fileSource, destination);
      setConvertedFile(output);
      downloadConvertedFile(output);
    } catch (caught) {
      setConvertedFile(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsConverting(false);
    }
  };

  const isKml = file ? detectCoordinateFileFormat(file.name) === "kml" : false;

  return (
    <div className="page coordinate-page file-converter-page">
      <nav className="breadcrumb" aria-label="パンくず"><Link to="/">Dashboard</Link><span>/</span><span>座標変換ツール</span></nav>
      <header className="simple-page-header">
        <h1>座標変換ツール</h1>
        <p>ファイルの座標系をブラウザ内で変換します。ファイルが外部へ送信されることはありません。</p>
      </header>

      <div className="file-converter-shell">
        <div className="file-config-column">
          <CrsControl id="file-source" title="現在の座標系" value={source} disabled={isKml}
            onChange={(crs) => { setSource(crs); clearResult(); }} />
          <CrsControl id="file-destination" title="変換後の座標系" value={destination}
            onChange={(crs) => { setDestination(crs); clearResult(); }} />

          <section className="file-settings-card output-card">
            <div className="file-card-heading">
              <span className="file-card-icon" aria-hidden="true">↓</span>
              <div><p>出力</p><strong>{convertedFile ? "変換・ダウンロード完了" : "出力形式を自動設定"}</strong></div>
            </div>
            <p className="output-description">
              {convertedFile
                ? `${convertedFile.pointCount.toLocaleString()}座標を変換・${convertedFile.fileName}`
                : "GeoJSON・CSV/TSVは同形式、KMLはGeoJSONで出力します。"}
            </p>
            <button type="button" className="button primary file-action-button" onClick={convert} disabled={!file || isConverting}>
              {isConverting ? "変換中…" : "変換を実行してダウンロード"}
            </button>
          </section>
        </div>

        <section className="file-drop-column" aria-labelledby="drop-title">
          <div className={`drop-zone ${isDragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false); }}
            onDrop={drop}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click(); }}
            role="button" tabIndex={0}>
            <input ref={fileInputRef} className="visually-hidden" type="file" accept=".geojson,.json,.kml,.csv,.tsv,.txt"
              onChange={(event) => acceptFile(event.target.files?.[0])} />
            <span className="drop-icon" aria-hidden="true">{file ? "✓" : "⇧"}</span>
            <h2 id="drop-title">{file ? "ファイルを受け付けました" : "ファイルをここにドロップ"}</h2>
            <p>{file ? "別のファイルに変更する場合は、再度ドロップしてください。" : "またはクリックしてファイルを選択"}</p>
            <span className="format-list">GeoJSON / KML / CSV / TSV　・　最大20MB</span>
          </div>

          {file && <div className="selected-file-card">
            <span className="selected-file-icon" aria-hidden="true">▤</span>
            <div><strong>{file.name}</strong><span>{humanFileSize(file.size)}・{detectCoordinateFileFormat(file.name).toUpperCase()}</span></div>
            <button type="button" onClick={(event) => { event.stopPropagation(); setFile(null); setConvertedFile(null); setError(""); }} aria-label="選択ファイルを解除">×</button>
          </div>}

          <div className="file-guidance">
            <h3>入力データについて</h3>
            <ul>
              <li>GeoJSONの座標は一般的な <code>x, y</code> 順として処理します。</li>
              <li>CSV/TSVは先頭2列を、左で表示される座標軸の順として処理します。</li>
              <li>KMLは仕様に従ってWGS84として自動設定されます。</li>
            </ul>
          </div>
          {error && <p className="file-error" role="alert">{error}</p>}
        </section>
      </div>
    </div>
  );
}
