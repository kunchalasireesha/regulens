import { describe, expect, it } from "vitest";
import { DEFAULT_QUEUE_FILTER, parseQueueFilter, queueHref } from "@/lib/dashboard/queues";

describe("parseQueueFilter", () => {
  it("accepts every queue and 'all'", () => {
    for (const value of ["needs_review", "in_progress", "failed", "approved", "rejected", "all"]) {
      expect(parseQueueFilter(value)).toBe(value);
    }
  });

  it("falls back to the default for a missing or unknown value", () => {
    expect(parseQueueFilter(undefined)).toBe(DEFAULT_QUEUE_FILTER);
    expect(parseQueueFilter("")).toBe(DEFAULT_QUEUE_FILTER);
    expect(parseQueueFilter("Failed")).toBe(DEFAULT_QUEUE_FILTER);
    expect(parseQueueFilter("toString")).toBe(DEFAULT_QUEUE_FILTER);
  });

  it("uses the first value of a repeated parameter", () => {
    expect(parseQueueFilter(["failed", "approved"])).toBe("failed");
  });
});

describe("queueHref", () => {
  it("links the default queue to the bare home page", () => {
    expect(queueHref(DEFAULT_QUEUE_FILTER)).toBe("/");
    expect(queueHref("failed")).toBe("/?queue=failed");
    expect(queueHref("all")).toBe("/?queue=all");
  });

  it("round-trips through parseQueueFilter", () => {
    for (const filter of ["needs_review", "in_progress", "failed", "approved", "rejected", "all"] as const) {
      const param = new URL(queueHref(filter), "http://localhost").searchParams.get("queue") ?? undefined;
      expect(parseQueueFilter(param)).toBe(filter);
    }
  });
});
