import en from "@/lib/i18n/messages/en";
import zhCN from "@/lib/i18n/messages/zh-CN";

export type Locale = "en" | "zh-CN";

export const messages = {
  en,
  "zh-CN": zhCN,
} as const;

export function normalizeLocale(value: string | null | undefined): Locale {
  return value === "zh-CN" ? "zh-CN" : "en";
}

export function getMessages(locale: Locale) {
  return messages[locale];
}
