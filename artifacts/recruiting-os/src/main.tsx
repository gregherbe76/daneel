import { createRoot } from "react-dom/client";
import App from "./App";
import { applyBrandTheme } from "./lib/apply-brand";
import "./index.css";

applyBrandTheme();

createRoot(document.getElementById("root")!).render(<App />);
