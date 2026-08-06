import { z } from "zod";

import { editableRuleDeltaSchema } from "@/lib/validation/radar-rules";
import type { EditableRuleDelta } from "@/types/contracts";

export const RULE_FLOW_STORAGE_KEY = "watch-anything.rule-flow";

const ruleFlowStorageSchema = z
  .object({
    originalPrompt: z.string().trim().min(1).max(4_000),
    ruleToken: z.string().min(1).max(8_192).optional(),
    editableDelta: editableRuleDeltaSchema.optional(),
  })
  .strict();

export type RuleFlowStorage = {
  originalPrompt: string;
  ruleToken?: string;
  editableDelta?: EditableRuleDelta;
};

function getLocalStorage(storage?: Storage): Storage | null {
  if (storage) {
    return storage;
  }

  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

export function readRuleFlowStorage(storage?: Storage): RuleFlowStorage | null {
  const localStorage = getLocalStorage(storage);

  if (!localStorage) {
    return null;
  }

  try {
    const raw = localStorage.getItem(RULE_FLOW_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const result = ruleFlowStorageSchema.safeParse(JSON.parse(raw));

    if (!result.success) {
      return null;
    }

    return result.data as RuleFlowStorage;
  } catch {
    return null;
  }
}

export function writeRuleFlowStorage(
  flow: RuleFlowStorage,
  storage?: Storage,
): void {
  const localStorage = getLocalStorage(storage);

  if (!localStorage) {
    return;
  }

  const safeFlow = {
    originalPrompt: flow.originalPrompt,
    ...(flow.ruleToken ? { ruleToken: flow.ruleToken } : {}),
    ...(flow.editableDelta
      ? { editableDelta: editableRuleDeltaSchema.parse(flow.editableDelta) }
      : {}),
  };

  const result = ruleFlowStorageSchema.safeParse(safeFlow);

  if (result.success) {
    localStorage.setItem(RULE_FLOW_STORAGE_KEY, JSON.stringify(result.data));
  }
}

export function clearRuleFlowStorage(storage?: Storage): void {
  getLocalStorage(storage)?.removeItem(RULE_FLOW_STORAGE_KEY);
}
