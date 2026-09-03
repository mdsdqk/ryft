/**
 * One date format for the whole app: `dd-MMM-yyyy` (e.g. `03-Sep-2026`).
 *
 * Display only. The data layer keeps dates as the raw ISO strings the API
 * returns (`2026-02-10`, `2026-02-11T14:12:00Z`); this renders either shape.
 * Calendar fields are read in UTC so a bare `yyyy-mm-dd` shows exactly as written
 * regardless of the viewer's timezone.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** An ISO date or timestamp as `dd-MMM-yyyy`; `—` when it can't be parsed. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${dd}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}
