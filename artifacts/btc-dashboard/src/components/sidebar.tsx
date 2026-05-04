import { Link, useLocation } from "wouter";
import { LayoutDashboard, BookOpen, Bitcoin, FlaskConical } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/strategy", label: "Our Strategy", icon: BookOpen },
  { href: "/backtest", label: "Backtest", icon: FlaskConical },
];

export default function Sidebar() {
  const [location] = useLocation();

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-52 shrink-0 border-r border-border bg-card min-h-screen sticky top-0 h-screen">
        <div className="flex items-center gap-2 px-5 py-5 border-b border-border">
          <Bitcoin className="w-5 h-5 text-primary shrink-0" />
          <span className="font-bold text-sm text-foreground leading-tight">KISBTC Strategy</span>
        </div>
        <nav className="flex flex-col gap-1 p-3 flex-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? location === "/" : location.startsWith(href);
            return (
              <Link key={href} href={href}>
                <div
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                </div>
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-4 border-t border-border">
          <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
            Questrade V4.0<br />Data: Kraken · Auto-refreshes every 60s
          </p>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <Bitcoin className="w-4 h-4 text-primary" />
          <span className="font-bold text-sm">BTC Strategy</span>
        </div>
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? location === "/" : location.startsWith(href);
            return (
              <Link key={href} href={href}>
                <div
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
