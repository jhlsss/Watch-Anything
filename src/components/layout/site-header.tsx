import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";

type NavLink = {
  href: string;
  label: string;
};

interface SiteHeaderProps {
  locale: Locale;
  basePath?: string;
  brand: string;
  localeLabel: string;
  localeNames: Record<Locale, string>;
  navLinks?: NavLink[];
  primaryAction?: NavLink;
  secondaryAction?: NavLink;
  className?: string;
}

function withLocale(href: string, locale: Locale) {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}lang=${locale}`;
}

function BrandMark() {
  return (
    <svg viewBox="0 0 40 40" className="h-8 w-8 text-violet-600" fill="none" aria-hidden="true">
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
  navLinks = [],
  primaryAction,
  secondaryAction,
  className,
}: SiteHeaderProps) {
  return (
    <header className={cn("border-b border-slate-200 bg-white/95 backdrop-blur", className)}>
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href={withLocale("/", locale)} className="flex items-center gap-3 font-semibold text-slate-950">
          <BrandMark />
          <span>{brand}</span>
        </Link>

        <div className="flex items-center gap-3">
          {navLinks.length > 0 ? (
            <nav className="hidden items-center gap-5 text-sm text-slate-600 min-[850px]:flex">
              {navLinks.map((item) => (
                <Link key={item.href} href={withLocale(item.href, locale)} className="transition hover:text-slate-950">
                  {item.label}
                </Link>
              ))}
            </nav>
          ) : null}

          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 p-1" aria-label={localeLabel}>
            {(Object.keys(localeNames) as Locale[]).map((value) => (
              <Link
                key={value}
                href={withLocale(basePath, value)}
                className={cn(
                  "rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition",
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
              className="hidden rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 min-[850px]:inline-flex"
            >
              {secondaryAction.label}
            </Link>
          ) : null}

          {primaryAction ? (
            <Link
              href={withLocale(primaryAction.href, locale)}
              className="inline-flex rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-200 transition hover:bg-violet-500"
            >
              {primaryAction.label}
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
