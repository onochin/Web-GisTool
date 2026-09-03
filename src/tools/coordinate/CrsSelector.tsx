import { useEffect, useState } from "react";
import { CRS_PRESETS } from "../../lib/crs/presets";
import { resolveCrs } from "../../lib/crs/resolver";
import type { CrsDefinition } from "../../lib/crs/types";
import { axisDescription } from "./display";

type Props = {
  id: string;
  label: string;
  value: CrsDefinition;
  onChange: (crs: CrsDefinition) => void;
};

export function CrsSelector({ id, label, value, onChange }: Props) {
  const [epsgInput, setEpsgInput] = useState(String(value.epsg));
  const [error, setError] = useState("");
  useEffect(() => { setEpsgInput(String(value.epsg)); setError(""); }, [value]);

  const applyEpsg = () => {
    try {
      onChange(resolveCrs(epsgInput));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <section className="crs-panel" aria-labelledby={`${id}-title`}>
      <p className="panel-kicker">{label}</p>
      <h2 id={`${id}-title`}>{value.shortName}</h2>
      <div className="epsg-pill">{value.code}</div>
      <label htmlFor={`${id}-preset`}>よく使う座標系</label>
      <select id={`${id}-preset`} value={value.code} onChange={(event) => onChange(resolveCrs(event.target.value))}>
        {CRS_PRESETS.map((crs) => <option value={crs.code} key={crs.code}>{crs.name}</option>)}
      </select>
      <label htmlFor={`${id}-epsg`}>EPSGコードを直接指定</label>
      <div className="inline-field">
        <input id={`${id}-epsg`} value={epsgInput} inputMode="numeric"
          onChange={(event) => setEpsgInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") applyEpsg(); }}
          aria-describedby={`${id}-epsg-help`} aria-invalid={Boolean(error)} />
        <button type="button" className="button secondary" onClick={applyEpsg}>適用</button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <dl className="crs-meta">
        <div><dt>単位</dt><dd>{value.unit === "degree" ? "degree（度）" : "metre（m）"}</dd></div>
        <div><dt>座標軸</dt><dd>{axisDescription(value)}</dd></div>
      </dl>
    </section>
  );
}
