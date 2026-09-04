import { Link } from "react-router-dom";
import { TOOLS } from "../../config/tools";
import previewMapUrl from "../../../map/web_photo_multi_layer_state_5_indexeddb.html?url";

export function Dashboard() {
  const availableTools = TOOLS.filter((tool) => tool.enabled);
  return (
    <div className="page dashboard-page">
      <section className="hero">
        <p className="eyebrow">WEBGIS TOOLS DASHBOARD</p>
        <h1>GIS作業を、ブラウザでもっと手軽に。</h1>
        <p>日常の座標・測地処理を、インストール不要で安全に実行できるユーティリティ集です。</p>
      </section>
      <p className="preview-map-link">
        <span>試作機能</span>
        <a href={previewMapUrl} target="_blank" rel="noopener noreferrer">確認用マップを開く <span aria-hidden="true">↗</span></a>
      </p>
      <section aria-labelledby="tools-title">
        <div className="section-heading">
          <div><p className="eyebrow">AVAILABLE TOOLS</p><h2 id="tools-title">利用可能なツール</h2></div>
          <span className="count-badge">{availableTools.length} tool</span>
        </div>
        <div className="tool-grid">
          {availableTools.map((tool) => (
            <Link to={tool.route} className="tool-card" key={tool.id}>
              <span className="tool-icon" aria-hidden="true">{tool.icon}</span>
              <span className="category-label">{tool.category}</span>
              <h3>{tool.name}</h3>
              <p>{tool.description}</p>
              <span className="card-link">ツールを開く <span aria-hidden="true">→</span></span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
