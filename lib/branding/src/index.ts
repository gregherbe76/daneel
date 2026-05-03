export const branding = {
  productName: "HireFlow",
  companyName: "HireFlow",
  logoUrl: "",
  colors: {
    primary: "#1e293b",
    accent: "#f97316",
    muted: "#64748b",
    divider: "#e2e8f0",
  },
} as const;

export type Branding = typeof branding;
