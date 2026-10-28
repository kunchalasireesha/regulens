export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Fixed time zone so server-rendered timestamps don't depend on the host's zone.
const timestampFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function formatTimestamp(date: Date): string {
  return `${timestampFormat.format(date)} UTC`;
}
