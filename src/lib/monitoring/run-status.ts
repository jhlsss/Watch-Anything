import type { RunStatus, SourceOutcome } from "@/types/contracts";

export type RunStatusOptions = {
  aiFailed?: boolean;
  telegramFailed?: boolean;
};

type SourceStatus = SourceOutcome | Pick<SourceOutcome, "success"> | boolean;

export type TerminalRunStatus = Exclude<RunStatus, "running">;

export function resolveRunStatus(
  outcomes: readonly SourceStatus[],
  options: RunStatusOptions = {},
): TerminalRunStatus {
  void options;
  return outcomes.some((outcome) =>
    typeof outcome === "boolean" ? outcome : outcome.success,
  )
    ? "success"
    : "failed";
}
