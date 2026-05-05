import { defineConfig, devices } from "@playwright/test";

const PORT_WITH_KEY = Number(process.env.PLAYWRIGHT_PROD_PORT_WITH_KEY ?? 4327);
const PORT_NO_KEY = Number(process.env.PLAYWRIGHT_PROD_PORT_NO_KEY ?? 4328);

const POSTHOG_KEY = "phc_e2e_test_key";

const buildAndServe = (port: number, outDir: string) =>
  [
    `pnpm exec vite build --outDir ${outDir} --emptyOutDir`,
    `pnpm exec vite preview --outDir ${outDir} --port ${port} --host 127.0.0.1 --strictPort`,
  ].join(" && ");

export default defineConfig({
  testDir: "./tests/e2e-prod",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: buildAndServe(PORT_WITH_KEY, "dist-prod-with-key"),
      url: `http://127.0.0.1:${PORT_WITH_KEY}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: {
        PORT: String(PORT_WITH_KEY),
        BASE_PATH: "/",
        VITE_APP_TEMPLATE: "hiringai",
        VITE_POSTHOG_KEY: POSTHOG_KEY,
        NODE_ENV: "production",
      },
    },
    {
      command: buildAndServe(PORT_NO_KEY, "dist-prod-no-key"),
      url: `http://127.0.0.1:${PORT_NO_KEY}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: {
        PORT: String(PORT_NO_KEY),
        BASE_PATH: "/",
        VITE_APP_TEMPLATE: "hiringai",
        // Explicitly blank so an inherited VITE_POSTHOG_KEY from the
        // surrounding shell can't leak into this "no key" build and make
        // the assertion non-deterministic.
        VITE_POSTHOG_KEY: "",
        NODE_ENV: "production",
      },
    },
  ],
});

export const PROD_E2E_PORTS = {
  withKey: PORT_WITH_KEY,
  noKey: PORT_NO_KEY,
};
