import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { CoordinateConverter } from "./pages/CoordinateConverter/CoordinateConverter";
import { Dashboard } from "./pages/Dashboard/Dashboard";
import { GisInfo } from "./pages/GisInfo/GisInfo";

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "") || undefined}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="coordinate" element={<CoordinateConverter />} />
          <Route path="gis-info" element={<GisInfo />} />
          <Route path="*" element={<Dashboard />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
