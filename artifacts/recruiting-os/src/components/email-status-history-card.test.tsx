import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  EmailStatusHistoryCard,
  type EmailStatusHistoryRow,
} from "./email-status-history-card";

function makeRow(
  overrides: Partial<EmailStatusHistoryRow> & Pick<EmailStatusHistoryRow, "id">,
): EmailStatusHistoryRow {
  return {
    previousStatus: "valid",
    newStatus: "risky",
    previousReason: null,
    newReason: null,
    changedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

describe("EmailStatusHistoryCard", () => {
  it("stays hidden when the candidate has no email on file (even if rows exist)", () => {
    render(
      <EmailStatusHistoryCard
        candidateEmail={null}
        rows={[makeRow({ id: 1 }), makeRow({ id: 2 })]}
      />,
    );
    expect(
      screen.queryByTestId("email-status-history-card"),
    ).not.toBeInTheDocument();
  });

  it("stays hidden when the candidate has an email but no history rows", () => {
    render(
      <EmailStatusHistoryCard
        candidateEmail="alice@example.com"
        rows={[]}
      />,
    );
    expect(
      screen.queryByTestId("email-status-history-card"),
    ).not.toBeInTheDocument();
  });

  it("renders the card with a count badge matching the number of rows", () => {
    const rows = [
      makeRow({ id: 10 }),
      makeRow({ id: 11 }),
      makeRow({ id: 12 }),
    ];
    render(
      <EmailStatusHistoryCard
        candidateEmail="alice@example.com"
        rows={rows}
      />,
    );

    const card = screen.getByTestId("email-status-history-card");
    expect(card).toBeInTheDocument();
    expect(within(card).getByText("Email status history")).toBeInTheDocument();

    const badge = screen.getByTestId("email-status-history-count");
    expect(badge).toHaveTextContent("3");
  });

  it("starts collapsed - the row list is not visible until the toggle is clicked", async () => {
    const rows = [makeRow({ id: 21 }), makeRow({ id: 22 })];
    render(
      <EmailStatusHistoryCard
        candidateEmail="alice@example.com"
        rows={rows}
      />,
    );

    expect(
      screen.queryByTestId("email-status-history-list"),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("toggle-email-status-history"));

    expect(
      screen.getByTestId("email-status-history-list"),
    ).toBeInTheDocument();
  });

  it(
    "renders rows in the order received (newest-first) with previous -> new status badges, " +
      "the validator reason, and a relative timestamp",
    async () => {
      // Caller is responsible for newest-first ordering. The API endpoint
      // already orders by changed_at DESC, and the component must preserve
      // that order one-to-one in the rendered list.
      const newest = makeRow({
        id: 101,
        previousStatus: "risky",
        newStatus: "invalid",
        previousReason: "catch-all detected",
        newReason: "mailbox bounced",
        changedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const middle = makeRow({
        id: 102,
        previousStatus: "valid",
        newStatus: "risky",
        previousReason: "smtp ok",
        newReason: "catch-all detected",
        changedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const oldest = makeRow({
        id: 103,
        previousStatus: "unknown",
        newStatus: "valid",
        previousReason: null,
        newReason: "smtp ok",
        changedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      });

      render(
        <EmailStatusHistoryCard
          candidateEmail="alice@example.com"
          rows={[newest, middle, oldest]}
        />,
      );

      await userEvent.click(screen.getByTestId("toggle-email-status-history"));

      const list = screen.getByTestId("email-status-history-list");
      const renderedRows = within(list).getAllByRole("listitem");
      expect(renderedRows).toHaveLength(3);

      // Newest first.
      expect(renderedRows[0]).toHaveAttribute(
        "data-testid",
        "email-status-history-row-101",
      );
      expect(renderedRows[1]).toHaveAttribute(
        "data-testid",
        "email-status-history-row-102",
      );
      expect(renderedRows[2]).toHaveAttribute(
        "data-testid",
        "email-status-history-row-103",
      );

      // Newest row shows both previous and new status badges + reason text.
      // EmailValidationBadge renders "Risky" for "risky" and "Undeliverable"
      // for "invalid", so look for both labels inside the row.
      const newestRowEl = screen.getByTestId("email-status-history-row-101");
      expect(within(newestRowEl).getByText("Risky")).toBeInTheDocument();
      expect(within(newestRowEl).getByText("Undeliverable")).toBeInTheDocument();
      expect(
        screen.getByTestId("email-status-history-row-101-reason"),
      ).toHaveTextContent("mailbox bounced");
      expect(
        screen.getByTestId("email-status-history-row-101-timestamp"),
      ).toBeInTheDocument();

      // Middle row: valid -> risky.
      const middleRowEl = screen.getByTestId("email-status-history-row-102");
      expect(within(middleRowEl).getByText("Verified")).toBeInTheDocument();
      expect(within(middleRowEl).getByText("Risky")).toBeInTheDocument();
      expect(
        screen.getByTestId("email-status-history-row-102-reason"),
      ).toHaveTextContent("catch-all detected");

      // Oldest row: unknown previous status has no badge mapping, but the
      // new "valid" status badge and the reason should still appear.
      const oldestRowEl = screen.getByTestId("email-status-history-row-103");
      expect(within(oldestRowEl).getByText("Verified")).toBeInTheDocument();
      expect(
        screen.getByTestId("email-status-history-row-103-reason"),
      ).toHaveTextContent("smtp ok");
    },
  );

  it("omits the reason segment when newReason is null", async () => {
    const row = makeRow({
      id: 999,
      previousStatus: "valid",
      newStatus: "risky",
      newReason: null,
    });
    render(
      <EmailStatusHistoryCard
        candidateEmail="alice@example.com"
        rows={[row]}
      />,
    );

    await userEvent.click(screen.getByTestId("toggle-email-status-history"));

    expect(
      screen.queryByTestId("email-status-history-row-999-reason"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("email-status-history-row-999-timestamp"),
    ).toBeInTheDocument();
  });
});
