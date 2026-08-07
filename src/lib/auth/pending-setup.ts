import {
  clearRuleFlowStorage,
} from "@/lib/auth/rule-flow-storage";
import type { RuleFlowStorage } from "@/lib/auth/rule-flow-storage";

export type PendingSetupResult =
  | { ok: true; next: "connect-telegram" | "radar"; radarId?: string }
  | { ok: false; error: string };

export async function submitPendingSetup(
  flow: RuleFlowStorage,
  fetcher: typeof fetch = fetch,
): Promise<PendingSetupResult> {
  try {
    const response = await fetcher("/api/pending-setups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalPrompt: flow.originalPrompt,
        ruleToken: flow.ruleToken,
        editableDelta: flow.editableDelta,
      }),
    });
    const body = (await response.json()) as {
      error?: string;
      next?: string;
      radarId?: string;
    };

    if (!response.ok) {
      return { ok: false, error: body.error ?? "PENDING_SETUP_FAILED" };
    }

    if (body.next === "radar" && body.radarId) {
      clearRuleFlowStorage();
      return { ok: true, next: "radar", radarId: body.radarId };
    }

    if (body.next !== "connect-telegram") {
      return { ok: false, error: "PENDING_SETUP_FAILED" };
    }

    clearRuleFlowStorage();
    return { ok: true, next: "connect-telegram" };
  } catch {
    return { ok: false, error: "PENDING_SETUP_FAILED" };
  }
}
