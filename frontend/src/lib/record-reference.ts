type ReferencedRecord = { id: string; reference?: string | null };

/** References come from the database, never from list position or a UUID hash. */
export function recordReference(record: ReferencedRecord, date?: string | null): string {
  if (!record.reference) return record.id; // Older API rollout compatibility.
  const reference = record.reference;
  if (!date || !Number.isFinite(new Date(date).getTime())) return reference;
  return `${reference} · ${new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore", day: "2-digit", month: "short", year: "numeric",
  }).format(new Date(date))}`;
}
