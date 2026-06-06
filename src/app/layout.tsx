import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "TalentBridge Agent",
  description:
    "Autonomous agent that scrapes US/EU virtual-assistant jobs daily and pitches vetted offshore talent.",
  applicationName: "TalentBridge",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    title: "TalentBridge Agent",
    description:
      "Daily VA job scraping + GPT scoring + outreach, on Vercel Hobby.",
    type: "website",
  },
  themeColor: "#04140f",
};

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/jobs", label: "Jobs" },
  { href: "/outreach", label: "Outreach" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${dmSans.variable} ${jetbrains.variable} font-sans`}>
        <div className="mesh-bg" aria-hidden />
        <header className="sticky top-0 z-40 border-b border-white/5 bg-background/40 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <Link
              href="/"
              className="flex items-center gap-2 text-lg font-semibold tracking-tight"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/40">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  className="h-4 w-4"
                  aria-hidden
                >
                  <path d="M3 12 9 5l3 7-3 7-6-7Z" strokeLinejoin="round" />
                  <path d="m12 12 9-7v14l-9-7Z" strokeLinejoin="round" />
                </svg>
              </span>
              Talent
              <span className="bg-gradient-to-r from-emerald-300 to-cyan-300 bg-clip-text text-transparent">
                Bridge
              </span>
            </Link>
            <nav className="flex gap-1 text-sm text-muted-foreground">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-3 py-1.5 transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
