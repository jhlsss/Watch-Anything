import Link from "next/link";
import { LayoutDashboard, Radar, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { getMessages, type Locale } from "@/lib/i18n";

interface AppSidebarProps {
  locale: Locale;
  currentPath: string;
}

const items = [
  { href: "/auth", key: "dashboard", icon: LayoutDashboard },
  { href: "/rules", key: "radars", icon: Radar },
  { href: "/connect-telegram", key: "telegram", icon: Send },
] as const;

function withLocale(href: string, locale: Locale) {
  return `${href}?lang=${locale}`;
}

export function AppSidebar({ locale, currentPath }: AppSidebarProps) {
  const copy = getMessages(locale);

  return (
    <>
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white min-[850px]:block">
        <div className="sticky top-0 flex min-h-screen flex-col px-5 py-6">
          <Link href={withLocale("/", locale)} className="mb-8 text-lg font-semibold text-slate-950">
            {copy.common.brand}
          </Link>
          <nav className="grid gap-2">
            {items.map(({ href, key, icon: Icon }) => {
              const active = currentPath === href;

              return (
                <Link
                  key={href}
                  href={withLocale(href, locale)}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950",
                    active && "bg-violet-50 text-violet-700",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {copy.nav[key]}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur min-[850px]:hidden">
        <div className="mx-auto grid max-w-md grid-cols-3 gap-2">
          {items.map(({ href, key, icon: Icon }) => {
            const active = currentPath === href;

            return (
              <Link
                key={href}
                href={withLocale(href, locale)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-xs font-semibold text-slate-500 transition",
                  active && "bg-violet-50 text-violet-700",
                )}
                >
                <Icon className="h-4 w-4" />
                <span>{copy.nav[key]}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
