// Keep repeated local runs distinguishable without putting UUIDs in visible names.
export function sampleEventTitle(name: string): string {
  const run = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3,
    hour12: false,
  }).format(new Date());
  return `${name} (${run})`;
}
