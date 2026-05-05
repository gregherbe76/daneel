import { test, expect, type Route } from "@playwright/test";
import { PROD_E2E_PORTS } from "../../playwright.prod.config";

const WITH_KEY_BASE = `http://127.0.0.1:${PROD_E2E_PORTS.withKey}`;
const NO_KEY_BASE = `http://127.0.0.1:${PROD_E2E_PORTS.noKey}`;

/**
 * Block all backend calls — these tests only care about whether the
 * telemetry consent banner is wired into the production-built bundle.
 * The landing page (`/`) does not need any data to render.
 */
async function blockApiAndPosthog(page: import("@playwright/test").Page) {
  await page.route("**/api/**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    }),
  );
  await page.route("**/*posthog*/**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}

test.describe("Telemetry consent banner — production build", () => {
  test.beforeEach(async ({ page }) => {
    await blockApiAndPosthog(page);
  });

  /**
   * One-time per-test reset of the origin's localStorage. Must be called
   * AFTER the first navigation (so the origin exists in the browser
   * context) but only once — using `addInitScript` here would re-clear
   * on every reload/navigation and defeat the persistence assertion.
   */
  async function clearConsent(page: import("@playwright/test").Page) {
    await page.evaluate(() => window.localStorage.clear());
  }

  test("appears on first load when VITE_POSTHOG_KEY is set, then stays hidden after declining and reloading", async ({
    page,
  }) => {
    await page.goto(`${WITH_KEY_BASE}/`);
    await clearConsent(page);
    await page.reload();

    const banner = page.getByTestId("telemetry-consent-banner");
    await expect(banner).toBeVisible();

    await page.getByTestId("telemetry-consent-no").click();
    await expect(banner).toHaveCount(0);

    // Persisted choice survives a real reload.
    await page.reload();
    await expect(page.getByTestId("telemetry-consent-banner")).toHaveCount(0);

    // And navigating to another route on the same origin keeps it hidden.
    await page.goto(`${WITH_KEY_BASE}/jobs`);
    await expect(page.getByTestId("telemetry-consent-banner")).toHaveCount(0);

    const consent = await page.evaluate(() =>
      window.localStorage.getItem("daneel.telemetryConsent"),
    );
    expect(consent).toBe("denied");
  });

  test("never appears when VITE_POSTHOG_KEY is unset (the common dev/preview state)", async ({
    page,
  }) => {
    await page.goto(`${NO_KEY_BASE}/`);
    await clearConsent(page);
    await page.reload();

    // Give the banner's effect a chance to run.
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("telemetry-consent-banner")).toHaveCount(0);

    // Same on a deeper route — the banner is mounted at the app root.
    await page.goto(`${NO_KEY_BASE}/jobs`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("telemetry-consent-banner")).toHaveCount(0);
  });
});
