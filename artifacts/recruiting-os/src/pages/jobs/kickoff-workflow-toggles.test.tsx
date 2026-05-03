import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { KickoffWorkflowToggles } from "./kickoff-workflow-toggles";
import { useKickoffDefaults } from "./use-kickoff-defaults";

// Tiny mock of the generated useGetJob hook so the harness mirrors the
// way JobDetailPage feeds the kickoff defaults: read job from the query,
// derive `realSourcingAvailable`, then run the auto-defaulting hook.
type MockJob = { id: string; title: string; hasRealSourcingProvider: boolean };
const useGetJob = vi.fn<(jobId: string) => { data: MockJob | undefined }>();

/**
 * Minimal harness that mirrors the slice of JobDetailPage which owns the
 * workflow kickoff toggles: useGetJob → useKickoffDefaults → render
 * KickoffWorkflowToggles. Used only for tests.
 */
function KickoffHarness({ jobId }: { jobId: string }) {
  const { data: job } = useGetJob(jobId);
  const realSourcingAvailable = job?.hasRealSourcingProvider ?? false;
  const {
    dataMode,
    runSourcing,
    userTouched,
    setDataMode,
    setRunSourcing,
  } = useKickoffDefaults(realSourcingAvailable, !!job);
  return (
    <KickoffWorkflowToggles
      dataMode={dataMode}
      runSourcing={runSourcing}
      userTouchedToggles={userTouched}
      realSourcingAvailable={realSourcingAvailable}
      workflowRunning={false}
      setDataMode={setDataMode}
      setRunSourcing={setRunSourcing}
    />
  );
}

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <Router hook={memoryLocation({ path: "/jobs/job-1" }).hook}>{ui}</Router>,
  );
}

describe("KickoffWorkflowToggles + useKickoffDefaults integration", () => {
  it(
    "auto-defaults to Real Data Run + Run Sourcing checked on first render " +
      "when the loaded job has a real sourcing provider configured",
    () => {
      useGetJob.mockReturnValue({
        data: { id: "job-1", title: "Senior Engineer", hasRealSourcingProvider: true },
      });

      renderWithRouter(<KickoffHarness jobId="job-1" />);

      const realButton = screen.getByTestId("kickoff-data-mode-real");
      const mockButton = screen.getByTestId("kickoff-data-mode-mock");
      // Selected button gets the green ring + amber for the unselected one.
      expect(realButton.className).toContain("ring-green-300");
      expect(mockButton.className).not.toContain("ring-amber-300");

      const sourcingCheckbox = screen.getByRole("checkbox", {
        name: /Source via Twin provider/i,
      });
      expect(sourcingCheckbox).toHaveAttribute("data-state", "checked");

      // The "defaulted to real" hint is visible; mock hint is not.
      expect(
        screen.getByTestId("kickoff-default-hint-real"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("kickoff-default-hint-mock"),
      ).not.toBeInTheDocument();
    },
  );

  it(
    "stays on Demo Run + sourcing-off on first render when the job has no " +
      "real sourcing provider configured",
    () => {
      useGetJob.mockReturnValue({
        data: { id: "job-1", title: "Senior Engineer", hasRealSourcingProvider: false },
      });

      renderWithRouter(<KickoffHarness jobId="job-1" />);

      const realButton = screen.getByTestId("kickoff-data-mode-real");
      const mockButton = screen.getByTestId("kickoff-data-mode-mock");
      expect(mockButton.className).toContain("ring-amber-300");
      expect(realButton.className).not.toContain("ring-green-300");

      const sourcingCheckbox = screen.getByRole("checkbox", {
        name: /Generate mock candidates before matching/i,
      });
      expect(sourcingCheckbox).toHaveAttribute("data-state", "unchecked");

      // The mock hint replaces the real-default hint.
      expect(
        screen.getByTestId("kickoff-default-hint-mock"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("kickoff-default-hint-real"),
      ).not.toBeInTheDocument();
    },
  );

  it(
    "clicking the Demo Run button after a real-default flips the choice and " +
      "removes the kickoff-default-hint-real hint paragraph",
    async () => {
      useGetJob.mockReturnValue({
        data: { id: "job-1", title: "Senior Engineer", hasRealSourcingProvider: true },
      });

      renderWithRouter(<KickoffHarness jobId="job-1" />);

      // Sanity: starts on real with the hint visible.
      expect(
        screen.getByTestId("kickoff-default-hint-real"),
      ).toBeInTheDocument();

      await userEvent.click(screen.getByTestId("kickoff-data-mode-mock"));

      const mockButton = screen.getByTestId("kickoff-data-mode-mock");
      expect(mockButton.className).toContain("ring-amber-300");
      expect(
        screen.queryByTestId("kickoff-default-hint-real"),
      ).not.toBeInTheDocument();
      // The mock hint should ALSO be hidden now — the user has explicitly
      // chosen, so neither "defaulted to X" hint applies anymore.
      expect(
        screen.queryByTestId("kickoff-default-hint-mock"),
      ).not.toBeInTheDocument();
    },
  );

  it(
    "a simulated job refetch (changing a non-toggle field) does not revert " +
      "the user's explicit Demo Run choice",
    async () => {
      // Wrapper that lets the test mutate the job's title between renders
      // (simulating a refetch returning a slightly different payload), while
      // hasRealSourcingProvider stays true. The hook must still respect the
      // recruiter's explicit toggle.
      function RefetchHarness() {
        const [title, setTitle] = useState("Senior Engineer");
        useGetJob.mockReturnValue({
          data: { id: "job-1", title, hasRealSourcingProvider: true },
        });
        return (
          <>
            <button
              type="button"
              data-testid="simulate-refetch"
              onClick={() => setTitle("Senior Engineer (updated)")}
            >
              refetch
            </button>
            <KickoffHarness jobId="job-1" />
          </>
        );
      }

      renderWithRouter(<RefetchHarness />);

      // Recruiter overrides the real default with Demo Run.
      await userEvent.click(screen.getByTestId("kickoff-data-mode-mock"));
      expect(screen.getByTestId("kickoff-data-mode-mock").className).toContain(
        "ring-amber-300",
      );

      // Simulate the parent's useGetJob returning a refreshed payload.
      await userEvent.click(screen.getByTestId("simulate-refetch"));

      // Mode must still be Demo Run; the auto-default does NOT win.
      expect(screen.getByTestId("kickoff-data-mode-mock").className).toContain(
        "ring-amber-300",
      );
      expect(
        screen.getByTestId("kickoff-data-mode-real").className,
      ).not.toContain("ring-green-300");
      // And the mock-default hint stays hidden because userTouched is true.
      expect(
        screen.queryByTestId("kickoff-default-hint-real"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("kickoff-default-hint-mock"),
      ).not.toBeInTheDocument();
    },
  );
});
