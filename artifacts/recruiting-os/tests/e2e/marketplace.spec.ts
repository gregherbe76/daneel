import { test, expect, type Route, type Request } from "@playwright/test";
import { CATALOG, CATEGORIES, PHASE_COPY } from "../../src/pages/settings/marketplace/catalog";

/**
 * In-memory provider store backing the mocked /api/providers endpoints.
 * Reset before every test via beforeEach.
 */
type ProviderRecord = {
  id: number;
  name: string;
  type: string;
  webhookUrl: string | null;
  baseUrl: string | null;
  apiKeyPlaceholder: string | null;
  config: unknown;
  enabled: boolean;
};

let providers: ProviderRecord[] = [];

async function mockApi(page: import("@playwright/test").Page) {
  // Catch-all so we never hit the real (unstarted) API server.
  await page.route("**/api/**", async (route: Route, request: Request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/providers" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(providers),
      });
    }
    if (path === "/api/providers" && method === "POST") {
      const body = JSON.parse(request.postData() ?? "{}") as Omit<
        ProviderRecord,
        "id"
      >;
      const next: ProviderRecord = {
        id: providers.length + 1,
        webhookUrl: null,
        baseUrl: null,
        apiKeyPlaceholder: null,
        config: null,
        enabled: true,
        ...body,
      };
      providers = [...providers, next];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(next),
      });
    }
    const updateMatch = path.match(/^\/api\/providers\/(\d+)$/);
    if (updateMatch && (method === "PUT" || method === "PATCH")) {
      const id = Number(updateMatch[1]);
      const body = JSON.parse(request.postData() ?? "{}") as Partial<
        Omit<ProviderRecord, "id">
      >;
      providers = providers.map((p) => (p.id === id ? { ...p, ...body, id } : p));
      const merged = providers.find((p) => p.id === id) ?? null;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(merged),
      });
    }
    if (path === "/api/workflow-provider-settings" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    }
    // Default empty success for anything else the page touches.
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });
}

test.beforeEach(async ({ page }) => {
  providers = [];
  await mockApi(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test.describe("Provider Marketplace", () => {
  test("renders the All view with every catalog card and the five category tabs", async ({
    page,
  }) => {
    await page.goto("/settings/marketplace");

    await expect(
      page.getByRole("heading", { name: "Provider Marketplace" }),
    ).toBeVisible();

    await expect(page.getByTestId("category-tab-all")).toContainText(
      `(${CATALOG.length})`,
    );
    for (const cat of CATEGORIES) {
      const tab = page.getByTestId(`category-tab-${cat.key}`);
      await expect(tab).toContainText(cat.label);
      const expected = CATALOG.filter((c) => c.category === cat.key).length;
      await expect(tab).toContainText(`(${expected})`);
    }

    for (const entry of CATALOG) {
      await expect(
        page.getByTestId(`marketplace-card-${entry.id}`),
      ).toBeVisible();
    }
  });

  for (const cat of CATEGORIES) {
    test(`'${cat.key}' tab filters to only that category's cards`, async ({
      page,
    }) => {
      await page.goto("/settings/marketplace");
      await page.getByTestId(`category-tab-${cat.key}`).click();

      const expectedIds = CATALOG.filter((c) => c.category === cat.key).map(
        (c) => c.id,
      );
      const otherIds = CATALOG.filter((c) => c.category !== cat.key).map(
        (c) => c.id,
      );

      for (const id of expectedIds) {
        await expect(page.getByTestId(`marketplace-card-${id}`)).toBeVisible();
      }
      for (const id of otherIds) {
        await expect(
          page.getByTestId(`marketplace-card-${id}`),
        ).toHaveCount(0);
      }
    });
  }

  const stubs = CATALOG.filter((c) => c.kind === "stub") as Extract<
    (typeof CATALOG)[number],
    { kind: "stub" }
  >[];

  test("catalog includes exactly the four expected A-Player stubs", async () => {
    expect(stubs.map((s) => s.id).sort()).toEqual(
      [
        "clearbit-enrich",
        "linkedin-recruiter",
        "outreach-agent",
        "twin-evaluator",
      ].sort(),
    );
  });

  for (const stub of stubs) {
    test(`A-Player ${stub.id} opens the Coming Soon dialog with phase ${stub.phase} copy`, async ({
      page,
    }) => {
      await page.goto("/settings/marketplace");
      await page.getByTestId(`connect-${stub.id}`).click();

      const dialog = page.getByTestId("coming-soon-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(stub.name);
      await expect(dialog).toContainText(PHASE_COPY[stub.phase]);

      await dialog.getByRole("button", { name: /got it/i }).click();
      await expect(dialog).toBeHidden();
    });
  }

  test("Custom Webhook flips from Disconnected to Connected after saving a webhook URL", async ({
    page,
  }) => {
    await page.goto("/settings/marketplace");

    const card = page.getByTestId("marketplace-card-custom-webhook");
    await expect(card).toContainText("Disconnected");

    await page.getByTestId("connect-custom-webhook").click();
    const dialog = page.getByTestId("connect-dialog-custom_webhook");
    await expect(dialog).toBeVisible();

    await dialog
      .getByTestId("custom-webhook-url")
      .fill("https://example.com/hook");
    await dialog.getByTestId("connect-save").click();
    await expect(dialog).toBeHidden();

    await expect(card).toContainText("Connected");
    await expect(page.getByTestId("connect-custom-webhook")).toContainText(
      "Manage",
    );
  });

  test("SerpAPI Web Search flips from Disconnected to Connected after saving", async ({
    page,
  }) => {
    await page.goto("/settings/marketplace");

    const card = page.getByTestId("marketplace-card-serpapi");
    await expect(card).toContainText("Disconnected");

    await page.getByTestId("connect-serpapi").click();
    const dialog = page.getByTestId("connect-dialog-serpapi");
    await expect(dialog).toBeVisible();

    await dialog.getByTestId("serpapi-key").fill("serpapi-test-key");
    await dialog.getByTestId("connect-save").click();
    await expect(dialog).toBeHidden();

    await expect(card).toContainText("Connected");
    await expect(page.getByTestId("connect-serpapi")).toContainText("Manage");
  });

  test("Apify Scrapers flips from Disconnected to Connected after saving the local key", async ({
    page,
  }) => {
    await page.goto("/settings/marketplace");

    const card = page.getByTestId("marketplace-card-apify");
    await expect(card).toContainText("Disconnected");

    await page.getByTestId("connect-apify").click();
    const dialog = page.getByTestId("connect-dialog-apify");
    await expect(dialog).toBeVisible();

    await dialog.getByTestId("apify-key").fill("apify_api_test_token");
    await dialog.getByTestId("connect-save").click();
    await expect(dialog).toBeHidden();

    const stored = await page.evaluate(() =>
      window.localStorage.getItem("hiringai.apifyKey"),
    );
    expect(stored).toBe("apify_api_test_token");
    await expect(card).toContainText("Connected");
    await expect(page.getByTestId("connect-apify")).toContainText("Manage");
  });
});

test.describe("Legacy settings paths redirect to /settings/marketplace", () => {
  for (const from of ["/settings", "/settings/providers", "/settings/agent-providers"]) {
    test(`visiting ${from} lands on /settings/marketplace`, async ({ page }) => {
      await page.goto(from);
      await page.waitForURL("**/settings/marketplace");
      expect(new URL(page.url()).pathname).toBe("/settings/marketplace");
      await expect(
        page.getByRole("heading", { name: "Provider Marketplace" }),
      ).toBeVisible();
    });
  }
});
