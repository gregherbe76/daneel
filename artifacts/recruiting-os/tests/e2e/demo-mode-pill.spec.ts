import { test, expect, type Route, type Request } from "@playwright/test";

/**
 * Covers the interactive "Demo mode" pill (see
 * `src/components/real-sourcing-pill.tsx`). The unit test in
 * `src/pages/jobs/real-sourcing-pill.test.tsx` already verifies that the
 * popover renders the right copy and CTA. This e2e test verifies the full
 * browser flow: clicking the pill, then "Configure real sourcing", actually
 * navigates the recruiter to /settings/marketplace.
 */

const DEMO_JOB = {
  id: 4242,
  title: "Senior Engineer (Demo)",
  description: "Demo job used by the e2e test.",
  location: "Remote",
  seniority: "Senior",
  mustHaveSkills: ["TypeScript"],
  hasRealSourcingProvider: false,
};

async function mockApi(page: import("@playwright/test").Page) {
  await page.route("**/api/**", async (route: Route, request: Request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/jobs" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([DEMO_JOB]),
      });
    }
    // Catch-all so the page never hits the (unstarted) API server.
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test.describe("Demo mode pill", () => {
  test("clicking the pill on the jobs list and then the CTA navigates to /settings/marketplace", async ({
    page,
  }) => {
    await page.goto("/jobs");

    const pill = page.getByTestId("real-sourcing-pill-demo");
    await expect(pill).toBeVisible();
    await expect(pill).toContainText("Demo mode");

    await pill.click();

    const popover = page.getByTestId("real-sourcing-pill-demo-popover");
    await expect(popover).toBeVisible();
    await expect(popover).toContainText("This job is in Demo mode");

    // Sanity-check we did NOT navigate to the job detail page when clicking
    // the pill (the pill lives inside a wouter <Link> wrapper).
    expect(new URL(page.url()).pathname).toBe("/jobs");

    await page.getByTestId("real-sourcing-pill-demo-cta").click();

    await page.waitForURL("**/settings/marketplace");
    expect(new URL(page.url()).pathname).toBe("/settings/marketplace");
  });
});
