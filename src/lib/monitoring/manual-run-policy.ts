const MVP_MANUAL_RUN_BYPASS_USER_IDS = new Set([
  // Temporary QA allowlist. Remove when MVP usage limits are finalized.
  "bf2a2366-47b7-40ba-aed5-04410f787fff",
  "a40b13f7-12d8-4b5a-a7d2-f2b55cc7e6cd",
]);

export function isMvpManualRunBypassUser(userId: string): boolean {
  return MVP_MANUAL_RUN_BYPASS_USER_IDS.has(userId);
}
