import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";
import { UserMenu } from "./user-menu";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ReguLens",
  description: "Licensing application intake: AI extraction, verified evidence, human review.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <nav className="flex items-center justify-between border-b border-zinc-200 px-6 py-2 dark:border-zinc-800">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            ReguLens
          </Link>
          {/* Reads the session, so it streams in without holding up the page. */}
          <Suspense fallback={null}>
            <UserMenu />
          </Suspense>
        </nav>
        {children}
      </body>
    </html>
  );
}
