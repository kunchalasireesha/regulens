"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const POLL_INTERVAL_MS = 2000;

/**
 * Re-renders the page's server components every few seconds while a document is queued
 * or processing, so a finished pipeline shows up without a manual reload. Stops polling
 * as soon as nothing is in flight. Renders nothing.
 */
export function RefreshWhileProcessing({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
