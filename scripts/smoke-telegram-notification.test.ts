import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Telegram notification smoke script", () => {
  it("reaches argument validation when started outside Next.js", () => {
    const scriptPath = resolve(
      process.cwd(),
      "scripts/smoke-telegram-notification.ts",
    );

    let stderr = "";
    try {
      execFileSync("pnpm", ["exec", "tsx", scriptPath], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const commandError = error as { stderr?: string | Buffer };
      stderr = String(commandError.stderr ?? "");
    }

    expect(stderr).toContain(
      "Usage: pnpm smoke:telegram -- --radar-id YOUR_REAL_RADAR_UUID",
    );
    expect(stderr).not.toContain("server-only");
  });
});
