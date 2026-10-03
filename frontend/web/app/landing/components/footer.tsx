import Link from "next/link";
import { ConnectMark } from "./connect-mark";

export function Footer() {
  const cols = [
    { title: "Product", links: ["Autopilot", "Inbox", "Workflows", "Analytics", "Integrations"] },
    { title: "Solutions", links: ["E-commerce", "SaaS", "Fintech", "Marketplaces", "Enterprise"] },
    { title: "Company", links: ["About", "Customers", "Careers", "Press", "Contact"] },
    { title: "Resources", links: ["Docs", "Changelog", "Blog", "Status", "Security"] },
  ];
  return (
    <footer className="border-t border-border bg-background px-6 pb-12 pt-20">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-6">
          <div className="col-span-2 max-w-xs">
            <ConnectMark />
            <p className="mt-4 text-sm text-muted-foreground">
              AI-native customer support for teams shipping worldwide.
            </p>
            <div className="mt-6 flex w-fit items-center gap-2 rounded-full border border-border px-3 py-1.5">
              <span className="relative flex h-2 w-2">
                <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-accent" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              <span className="text-xs text-muted-foreground">All systems operational</span>
            </div>
          </div>
          {cols.map((c) => (
            <div key={c.title}>
              <div className="mb-4 font-mono text-xs uppercase tracking-widest text-muted-foreground">
                {c.title}
              </div>
              <ul className="space-y-2.5">
                {c.links.map((l) => (
                  <li key={l}>
                    <a
                      href="#"
                      className="text-sm text-ink transition-colors hover:text-muted-foreground"
                    >
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col-reverse items-start justify-between gap-6 border-t border-border pt-8 md:flex-row md:items-center">
          <p className="text-xs text-muted-foreground">
            &copy; 2026 Connect Labs, Inc. &middot; Built for the world&apos;s support teams.
          </p>
          <div className="flex items-center gap-6 text-xs text-muted-foreground">
            <Link href="/privacy">Privacy</Link>
            <a href="#">Terms</a>
            <a href="#">Security</a>
            <a href="#">Cookies</a>
          </div>
        </div>

        <div className="mt-16 overflow-hidden">
          <div className="whitespace-nowrap text-center font-display text-[22vw] leading-none tracking-[-0.04em] text-ink/95">
            Connect<span className="text-accent">.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
