import { createRoot } from "react-dom/client";
import App from "./App";
import { applyBrandTheme } from "./lib/apply-brand";
import { initIfConsented } from "./lib/telemetry";
import "./index.css";

applyBrandTheme();
initIfConsented();

createRoot(document.getElementById("root")!).render(<App />);
