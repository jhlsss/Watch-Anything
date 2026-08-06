import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";
import { BrandMark } from "@/components/layout/site-header";

interface RulesHeaderProps {
  locale: Locale;
  brand: string;
  localeLabel: string;
  localeNames: Record<Locale, string>;
  process: readonly string[];
  request?: string;
}

function withLocale(href: string, locale: Locale, request?: string) {
  return `${href}?lang=${locale}${request?.trim() ? `&request=${encodeURIComponent(request.trim())}` : ""}`;
}

export function RulesHeader({
  locale,
  brand,
  localeLabel,
  localeNames,
  process,
  request,
}: RulesHeaderProps) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-4 min-[700px]:flex-nowrap">
        <Link
          href={withLocale("/", locale)}
          className="flex min-w-0 shrink-0 items-center gap-2 text-sm font-semibold text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 sm:text-base"
        >
          <BrandMark />
          <span>{brand}</span>
        </Link>

        <ol className="order-3 flex w-full min-w-0 items-center justify-center gap-2 text-xs min-[700px]:order-none min-[700px]:w-auto min-[700px]:flex-1 min-[700px]:gap-3">
          {process.map((step, index) => {
            const completed = index < 2;
            const current = index === 1;

            return (
              <li key={step} className="flex min-w-0 items-center gap-2">
                <span
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                    completed ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-500",
                  )}
                >
                  {index + 1}
                </span>
                <span className={cn("whitespace-nowrap", current ? "font-semibold text-slate-700" : "text-slate-500")}>
                  {step}
                </span>
                {index < process.length - 1 ? <span className="h-px w-8 bg-slate-200 sm:w-12" aria-hidden="true" /> : null}
              </li>
            );
          })}
        </ol>

        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1" aria-label={localeLabel}>
          {(Object.keys(localeNames) as Locale[]).map((value) => (
            <Link
              key={value}
              href={withLocale("/rules", value, request)}
              className={cn(
                "inline-flex min-h-8 items-center rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2",
                value === locale && "bg-white text-slate-950 shadow-sm",
              )}
            >
              {localeNames[value]}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}
