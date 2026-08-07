import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";

type NavLink = {
  href: string;
  label: string;
};

const SITE_RAIL =
  "mx-auto flex w-[calc(100%_-_28px)] max-w-[1160px] min-w-0 flex-nowrap items-center justify-between gap-2 py-3 min-[850px]:w-[calc(100%_-_44px)] sm:gap-4 sm:py-4";

interface SiteHeaderProps {
  locale: Locale;
  basePath?: string;
  brand: string;
  localeLabel: string;
  localeNames: Record<Locale, string>;
  currentHash?: string;
  navLinks?: NavLink[];
  accountAction?: NavLink;
  primaryAction?: NavLink;
  secondaryAction?: NavLink;
  className?: string;
}

function withLocale(href: string, locale: Locale, currentHash = "") {
  const hashIndex = href.indexOf("#");
  const pathAndQuery = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? currentHash : href.slice(hashIndex);
  const separator = pathAndQuery.includes("?") ? "&" : "?";

  return `${pathAndQuery}${separator}lang=${locale}${hash}`;
}

export function BrandMark() {
  return (
    <svg viewBox="0 0 40 40" className="h-7 w-7 text-violet-600 sm:h-8 sm:w-8" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="15" stroke="currentColor" strokeWidth="3" />
      <circle cx="20" cy="20" r="8" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="20" cy="20" r="2.7" fill="currentColor" />
      <path d="M20 20L31 13" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function SiteHeader({
  locale,
  basePath = "/",
  brand,
  localeLabel,
  localeNames,
  currentHash = "",
  navLinks = [],
  accountAction,
  primaryAction,
  secondaryAction,
  className,
}: SiteHeaderProps) {
  return (
    <header className={cn("border-b border-slate-200 bg-white/95 backdrop-blur", className)}>
      <div className={SITE_RAIL}>
        <Link href={withLocale("/", locale)} className="flex min-w-0 shrink-0 items-center gap-2 text-sm font-semibold text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 sm:gap-3 sm:text-base">
          <BrandMark />
          <span>{brand}</span>
        </Link>

        <div className="flex min-w-0 flex-nowrap items-center justify-end gap-2 sm:gap-3">
          {navLinks.length > 0 ? (
            <nav className="hidden items-center gap-5 text-sm text-slate-600 min-[850px]:flex">
              {navLinks.map((item) => (
                <Link key={item.href} href={withLocale(item.href, locale)} className="rounded-md transition hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2">
                  {item.label}
                </Link>
              ))}
            </nav>
          ) : null}

          {accountAction ? (
            <Link
              href={withLocale(accountAction.href, locale)}
              title={accountAction.label}
              className="inline-flex min-h-10 max-w-[132px] min-w-0 items-center rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 sm:max-w-[220px] sm:text-sm"
            >
              <span className="truncate">{accountAction.label}</span>
            </Link>
          ) : null}

          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1" aria-label={localeLabel}>
            {(Object.keys(localeNames) as Locale[]).map((value) => (
              <Link
                key={value}
                href={withLocale(basePath, value, currentHash)}
                className={cn(
                  "inline-flex min-h-10 items-center rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2",
                  value === locale && "bg-white text-slate-950 shadow-sm",
                )}
              >
                {localeNames[value]}
              </Link>
            ))}
          </div>

          {secondaryAction ? (
            <Link
              href={withLocale(secondaryAction.href, locale)}
              className="hidden min-h-10 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 min-[850px]:inline-flex"
            >
              {secondaryAction.label}
            </Link>
          ) : null}

          {primaryAction ? (
            <Link
              href={withLocale(primaryAction.href, locale)}
              className="inline-flex min-h-10 whitespace-nowrap rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-200 transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 sm:px-4 sm:text-sm"
            >
              {primaryAction.label}
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
