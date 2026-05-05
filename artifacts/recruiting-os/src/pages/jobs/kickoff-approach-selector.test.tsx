import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { useState } from "react";
import { KickoffWorkflowToggles } from "./kickoff-workflow-toggles";
import type { KickoffApproach } from "./use-kickoff-defaults";

function Harness({ initial = "jd-scout" as KickoffApproach }) {
  const [approach, setApproach] = useState<KickoffApproach>(initial);
  return (
    <KickoffWorkflowToggles
      dataMode="real"
      runSourcing={true}
      userTouchedToggles={true}
      realSourcingAvailable={true}
      workflowRunning={false}
      setDataMode={() => {}}
      setRunSourcing={() => {}}
      approach={approach}
      setApproach={setApproach}
    />
  );
}

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <Router hook={memoryLocation({ path: "/jobs/job-1" }).hook}>{ui}</Router>,
  );
}

describe("KickoffWorkflowToggles 3-mode kickoff approach selector", () => {
  it("renders all three options with Extend disabled (Phase 3 placeholder)", () => {
    renderWithRouter(<Harness />);
    expect(screen.getByTestId("kickoff-approach-panel")).toBeInTheDocument();
    expect(screen.getByTestId("kickoff-approach-jd-scout")).not.toBeDisabled();
    expect(screen.getByTestId("kickoff-approach-example-profiles")).toBeDisabled();
    expect(screen.getByTestId("kickoff-approach-agent-explore")).not.toBeDisabled();
    expect(screen.getByText(/Extend — ships in Phase 3/)).toBeInTheDocument();
    expect(screen.getByText(/Twin Agent Browser/)).toBeInTheDocument();
  });

  it("flips selection when the recruiter clicks the Twin agent-explore radio", async () => {
    renderWithRouter(<Harness initial="jd-scout" />);
    expect(screen.getByTestId("kickoff-approach-jd-scout")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.click(screen.getByTestId("kickoff-approach-agent-explore"));
    expect(screen.getByTestId("kickoff-approach-agent-explore")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("kickoff-approach-jd-scout")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("hides the panel when sourcing is off (no approach to pick)", () => {
    function Off() {
      return (
        <KickoffWorkflowToggles
          dataMode="real"
          runSourcing={false}
          userTouchedToggles={true}
          realSourcingAvailable={true}
          workflowRunning={false}
          setDataMode={() => {}}
          setRunSourcing={() => {}}
          approach="jd-scout"
          setApproach={() => {}}
        />
      );
    }
    renderWithRouter(<Off />);
    expect(screen.queryByTestId("kickoff-approach-panel")).not.toBeInTheDocument();
  });
});
