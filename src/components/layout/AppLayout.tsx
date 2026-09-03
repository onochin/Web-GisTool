import { Link, Outlet } from "react-router-dom";

export function AppLayout() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link to="/" className="brand" aria-label="WebGIS Tools ホーム">
          <span className="brand-mark" aria-hidden="true">⌖</span>
          <span><strong>WebGIS Tools</strong><small>GIS utility dashboard</small></span>
        </Link>
      </header>
      <main className="main-content"><Outlet /></main>
      <footer className="site-footer">WebGIS Tools — browser-based GIS utilities</footer>
    </div>
  );
}
