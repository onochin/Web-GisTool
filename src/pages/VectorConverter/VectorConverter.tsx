import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { resolveCrs } from "../../lib/crs/resolver";
import { analyzeVectorFile, convertVectorFile, MAX_VECTOR_FILE_SIZE } from "../../lib/vector/converter";
import { safeBaseName } from "../../lib/vector/common";
import { supportedOutputFormats, VECTOR_FORMAT_LABELS, type VectorFileAnalysis, type VectorFormat } from "../../lib/vector/types";

function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function crsLabel(analysis: VectorFileAnalysis, layerName: string): { name: string; epsg: string } {
  const crs = analysis.layers.find((layer) => layer.name === layerName)?.crs;
  if (!crs) return { name: "不明", epsg: "不明" };
  const epsg = crs.epsg ? `EPSG:${crs.epsg}` : crs.equivalentEpsg ? `EPSG:${crs.equivalentEpsg} 相当` : "不明";
  return { name: crs.name ?? "不明", epsg };
}

export function VectorConverter() {
  const inputRef = useRef<HTMLInputElement>(null);
  const sequenceRef = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<VectorFileAnalysis | null>(null);
  const [layerName, setLayerName] = useState("");
  const [outputFormat, setOutputFormat] = useState<VectorFormat>("kml");
  const [outputLayerName, setOutputLayerName] = useState("layer");
  const [manualEpsg, setManualEpsg] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const selectedLayer = analysis?.layers.find((layer) => layer.name === layerName) ?? null;
  const outputOptions = useMemo(() => supportedOutputFormats("vector").filter((format) => format !== analysis?.format), [analysis]);
  const needsManualEpsg = Boolean(selectedLayer && !selectedLayer.crs.epsg && !selectedLayer.crs.equivalentEpsg
    && (outputFormat === "geojson" || outputFormat === "kml" || outputFormat === "geopackage"));

  useEffect(() => {
    if (!outputOptions.includes(outputFormat)) setOutputFormat(outputOptions[0] ?? "geojson");
  }, [outputFormat, outputOptions]);

  const acceptFile = async (nextFile?: File) => {
    if (!nextFile) return;
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    setFile(nextFile); setAnalysis(null); setError(""); setWarnings([]); setManualEpsg(""); setIsAnalyzing(true);
    setOutputLayerName(safeBaseName(nextFile.name));
    try {
      if (nextFile.size > MAX_VECTOR_FILE_SIZE) throw new Error("ファイルサイズは100MB以下にしてください");
      const result = await analyzeVectorFile(nextFile);
      if (sequence !== sequenceRef.current) return;
      setAnalysis(result);
      setLayerName(result.layers[0]?.name ?? "");
      setOutputLayerName(result.layers[0]?.name ?? safeBaseName(nextFile.name));
      setWarnings(result.warnings);
    } catch (caught) {
      if (sequence === sequenceRef.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (sequence === sequenceRef.current) setIsAnalyzing(false);
    }
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); setIsDragging(false); void acceptFile(event.dataTransfer.files[0]);
  };

  const clear = () => {
    sequenceRef.current += 1;
    setFile(null); setAnalysis(null); setLayerName(""); setError(""); setWarnings([]); setIsAnalyzing(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const convert = async () => {
    if (!file || !analysis || !layerName) return;
    setIsConverting(true); setError(""); setWarnings(analysis.warnings);
    try {
      let sourceEpsg: number | null = null;
      if (manualEpsg.trim()) sourceEpsg = resolveCrs(manualEpsg).epsg;
      if (needsManualEpsg && !sourceEpsg) throw new Error("入力CRSのEPSG番号を指定してください");
      const output = await convertVectorFile(file, analysis, layerName, outputFormat, {
        manualSourceEpsg: sourceEpsg,
        outputLayerName: outputLayerName.trim() || safeBaseName(file.name),
      });
      setWarnings(output.warnings);
      const url = URL.createObjectURL(new Blob([output.bytes as BlobPart], { type: output.mimeType }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = output.fileName; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsConverting(false);
    }
  };

  const crs = analysis ? crsLabel(analysis, layerName) : null;
  return <div className="page file-converter-page vector-converter-page">
    <nav className="breadcrumb" aria-label="パンくず"><Link to="/">Dashboard</Link><span>/</span><span>ベクター変換</span></nav>
    <header className="simple-page-header">
      <h1>ベクター変換</h1>
      <p>GISベクターファイルをブラウザ内で相互変換します。ファイルが外部へ送信されることはありません。</p>
    </header>

    <div className="vector-converter-shell">
      <section className="vector-settings-panel" aria-live="polite">
        {!analysis && !isAnalyzing && <div className="vector-empty-state"><span aria-hidden="true">⇄</span><h2>変換設定</h2><p>ファイルをドロップすると設定を表示します</p></div>}
        {isAnalyzing && <div className="vector-empty-state"><span className="analysis-spinner" aria-hidden="true" /><h2>解析中...</h2><p>{file?.name}</p></div>}
        {analysis && !isAnalyzing && <>
          <section className="vector-setting-section">
            <h2>入力ファイル</h2>
            <dl className="gis-info-rows">
              <div><dt>ファイル名</dt><dd>{analysis.fileName}</dd></div>
              <div><dt>形式</dt><dd>{VECTOR_FORMAT_LABELS[analysis.format]}</dd></div>
              <div><dt>種類</dt><dd>Vector</dd></div>
              <div><dt>CRS</dt><dd>{crs?.name}</dd></div>
              <div><dt>EPSG</dt><dd>{crs?.epsg}</dd></div>
              <div><dt>Geometry</dt><dd>{selectedLayer?.geometryType ?? "不明"}</dd></div>
              <div><dt>Feature数</dt><dd>{selectedLayer?.featureCount.toLocaleString() ?? "不明"}</dd></div>
            </dl>
          </section>

          {analysis.layers.length > 1 && <section className="vector-setting-section">
            <label htmlFor="vector-layer">レイヤー</label>
            <select id="vector-layer" value={layerName} onChange={(event) => { setLayerName(event.target.value); setOutputLayerName(event.target.value); setWarnings(analysis.warnings); }}>
              {analysis.layers.map((layer) => <option value={layer.name} key={layer.name}>{layer.name}</option>)}
            </select>
          </section>}

          <section className="vector-setting-section">
            <label htmlFor="vector-output-format">出力形式</label>
            <select id="vector-output-format" value={outputFormat} onChange={(event) => { setOutputFormat(event.target.value as VectorFormat); setWarnings(analysis.warnings); }}>
              {outputOptions.map((format) => <option value={format} key={format}>{VECTOR_FORMAT_LABELS[format]}</option>)}
            </select>
            <p className="vector-output-crs">出力CRS：{outputFormat === "geojson" || outputFormat === "kml" ? "WGS84（経度, 緯度）" : crs?.name}</p>
          </section>

          {needsManualEpsg && <section className="vector-setting-section">
            <label htmlFor="vector-source-epsg">入力CRSのEPSG番号</label>
            <input id="vector-source-epsg" value={manualEpsg} inputMode="numeric" placeholder="例: 6677" onChange={(event) => setManualEpsg(event.target.value)} />
            <p className="vector-setting-note">CRSを推測せず、この値を変換元として使用します。</p>
          </section>}

          {outputFormat === "geopackage" && <section className="vector-setting-section">
            <label htmlFor="vector-output-layer">出力レイヤー名</label>
            <input id="vector-output-layer" value={outputLayerName} onChange={(event) => setOutputLayerName(event.target.value)} />
          </section>}

          {outputFormat === "shapefile" && <p className="vector-format-warning">Shapefileは1レイヤー1種類のGeometryに制限され、長い属性名や日本語属性名が変更される場合があります。</p>}
          <button type="button" className="button primary vector-convert-button" disabled={isConverting || outputOptions.length === 0} onClick={() => void convert()}>
            {isConverting ? "変換中..." : "変換してダウンロード"}
          </button>
        </>}
        {warnings.length > 0 && <div className="vector-warning-list"><strong>注意</strong><ul>{[...new Set(warnings)].map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
        {error && <p className="file-error" role="alert">{error}</p>}
      </section>

      <section className="vector-drop-column" aria-labelledby="vector-drop-title">
        <div className={`drop-zone ${isDragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }} onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false); }} onDrop={drop}
          onClick={() => inputRef.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }} role="button" tabIndex={0}>
          <input ref={inputRef} className="visually-hidden" type="file" accept=".geojson,.json,.kml,.zip,.gpkg" onChange={(event) => void acceptFile(event.target.files?.[0])} />
          <span className="drop-icon" aria-hidden="true">{isAnalyzing ? "…" : file ? "✓" : "⇧"}</span>
          <h2 id="vector-drop-title">{file ? "ファイルを受け付けました" : "ファイルをここにドロップ"}</h2>
          <p>{file ? "別のファイルもそのままドロップできます。" : "またはクリックしてファイルを選択"}</p>
          <span className="format-list">GeoJSON / KML / Shapefile ZIP / GPKG</span>
        </div>
        {file && <div className="selected-file-card">
          <span className="selected-file-icon" aria-hidden="true">▤</span>
          <div><strong>{file.name}</strong><span>{humanFileSize(file.size)}{analysis ? `・${VECTOR_FORMAT_LABELS[analysis.format]}` : ""}</span></div>
          <button type="button" onClick={clear} aria-label="選択ファイルを解除">×</button>
        </div>}
        <div className="file-guidance"><h3>入力について</h3><ul>
          <li>Shapefileは.shp / .shx / .dbfを含むZIPを使用してください。</li>
          <li>GeoPackageは1回につき1つのVectorレイヤーを変換します。</li>
          <li>最大ファイルサイズは100MBです。</li>
        </ul></div>
      </section>
    </div>
  </div>;
}

