import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import appCss from "../styles.css?url";
import { Providers } from "@/components/providers";
import { ConnectWallet } from "@/components/connect-wallet";
import { Toaster } from "@/components/ui/sonner";
import { useSelectedWalletAccount } from "@solana/react";
import { ADMIN_ADDRESS } from "@/lib/program";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Red Packet" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <Providers>
      <AppShell />
      <Toaster />
    </Providers>
  );
}

function AppShell() {
  const [selectedAccount] = useSelectedWalletAccount();
  const isAdmin = selectedAccount?.address === ADMIN_ADDRESS;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <nav className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link
              to="/"
              className="text-lg font-bold tracking-tight text-red-600"
            >
              Red Packet
            </Link>
            <div className="flex items-center gap-4 text-sm">
              <Link
                to="/"
                activeProps={{ className: "font-semibold text-foreground" }}
                inactiveProps={{ className: "text-muted-foreground" }}
                activeOptions={{ exact: true }}
              >
                Create
              </Link>
              <Link
                to="/dashboard"
                activeProps={{ className: "font-semibold text-foreground" }}
                inactiveProps={{ className: "text-muted-foreground" }}
              >
                Dashboard
              </Link>
              {isAdmin && (
                <Link
                  to="/admin"
                  activeProps={{ className: "font-semibold text-foreground" }}
                  inactiveProps={{ className: "text-muted-foreground" }}
                >
                  Admin
                </Link>
              )}
            </div>
          </div>
          <ConnectWallet />
        </nav>
      </header>
      <div className="bg-amber-950/50 border-b border-amber-800/30">
        <p className="mx-auto max-w-4xl px-4 py-1.5 text-center text-xs text-amber-400">
          Devnet only — this app uses Solana devnet tokens with no real value
        </p>
      </div>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
