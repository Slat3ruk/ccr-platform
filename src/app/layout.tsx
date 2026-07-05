import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import { RoleProvider } from "@/lib/role";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cross Current Racing — Car/Track Intel",
  description: "Data-driven car-to-track recommendation engine for Le Mans Ultimate.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RoleProvider>
          <div className="app">
            <nav className="rail" aria-label="Servers">
              <div className="rail-logo" title="Cross Current Racing">
                CC
              </div>
              <div className="rail-divider" />
              <div className="rail-icon" title="LMU Intel">
                🏁
              </div>
            </nav>
            <Sidebar />
            <main className="main">{children}</main>
          </div>
        </RoleProvider>
      </body>
    </html>
  );
}
