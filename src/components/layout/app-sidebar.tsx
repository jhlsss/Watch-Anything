import Link from "next/link";
import { LayoutDashboard, Radar, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { getMessages, type Locale } from "@/lib/i18n";

interface AppSidebarProps {
  locale: Locale;
  currentPath: string;
}

const items = [
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
  { href: "/radars", key: "radars", icon: Radar },
  { href: "/connect-telegram", key: "telegram", icon: Send },
] as const;

function withLocale(href: string, locale: Locale) {
  return `${href}?lang=${locale}`;
}

export function AppSidebar({ locale, currentPath }: AppSidebarProps) {
  const copy = getMessages(locale);

  return (
    <>
      <aside className="hidden w-60 shrink-0 bg-slate-950 text-white min-[850px]:block">
        <div className="sticky top-0 flex min-h-screen flex-col px-4 py-6">
          <Link href={withLocale("/", locale)} className="flex items-center gap-3 px-3 text-sm font-semibold text-white">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-violet-500 text-white">
              <Radar className="h-4 w-4" aria-hidden="true" />
            </span>
            {copy.common.brand}
          </Link>
          <nav className="mt-8 grid gap-2" aria-label={copy.nav.workspaceNavigation}>
            {items.map(({ href, key, icon: Icon }) => {
              const active = currentPath === href || (href === "/radars" && currentPath.startsWith("/radars/"));

              return (
                <Link
                  key={href}
                  href={withLocale(href, locale)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white",
                    active && "bg-white/10 text-white",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {copy.nav[key]}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur min-[850px]:hidden"
        aria-label={copy.nav.workspaceNavigation}
      >
        <div className="mx-auto grid max-w-md grid-cols-3 gap-2">
          {items.map(({ href, key, icon: Icon }) => {
            const active = currentPath === href || (href === "/radars" && currentPath.startsWith("/radars/"));

            return (
              <Link
                key={href}
                href={withLocale(href, locale)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-xs font-semibold text-slate-500 transition",
                  active && "bg-violet-50 text-violet-700",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{copy.nav[key]}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
