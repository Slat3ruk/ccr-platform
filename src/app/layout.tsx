import type { Metadata } from "next";
import NavShell from "@/components/NavShell";
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
            <NavShell />
            <main className="main">{children}</main>
          </div>
        </RoleProvider>
      </body>
    </html>
  );
}
