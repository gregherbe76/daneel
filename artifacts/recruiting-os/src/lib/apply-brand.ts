import { branding } from "@workspace/branding";

function hexToHsl(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hue = 0;
  let sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        hue = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        hue = (b - r) / d + 2;
        break;
      case b:
        hue = (r - g) / d + 4;
        break;
    }
    hue /= 6;
  }
  return `${Math.round(hue * 360)} ${Math.round(sat * 100)}% ${Math.round(l * 100)}%`;
}

export function applyBrandTheme(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const primaryHsl = hexToHsl(branding.colors.primary);
  const accentHsl = hexToHsl(branding.colors.accent);

  // Primary CTAs (Create Job, Start hiring, badges) adopt brand primary
  root.style.setProperty("--primary", primaryHsl);
  root.style.setProperty("--ring", primaryHsl);

  // Sidebar active-item indicator + chip get the brand accent — matches the
  // inline-style chip in layout.tsx so the whole sidebar reads as brand-colored
  root.style.setProperty("--sidebar-primary", accentHsl);
  root.style.setProperty("--sidebar-ring", accentHsl);
}
