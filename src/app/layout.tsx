import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "MoKnowledge",
  description:
    "Turns a company website into a structured knowledge base for MoFlo Cloud content apps — without inventing anything the site never said.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Floating rounded nav bar, matching the MoFlo platform header. */}
        <header className="mx-auto max-w-[1400px] px-4 pt-4 sm:px-6">
          <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 rounded-full px-5 py-2.5">
            <Link
              href="/knowledge"
              className="text-base font-bold tracking-tight text-ink-900"
            >
              Mo<span className="text-accent-600">Knowledge</span>
            </Link>
            <nav className="flex items-center gap-5 text-sm">
              <Link href="/knowledge" className="text-ink-700 hover:text-accent-600">
                Build
              </Link>
              <Link href="/knowledge/view" className="text-ink-700 hover:text-accent-600">
                Saved knowledge bases
              </Link>
            </nav>
            <p className="hint ml-auto hidden lg:block">
              No live LLM calls in this build — synthesis fields show labelled placeholders.
            </p>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
