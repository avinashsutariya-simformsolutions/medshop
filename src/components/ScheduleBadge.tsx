import type { Schedule } from "../db/types";

/** Red tag for prescription medicines; nothing for OTC. */
export function ScheduleBadge({ schedule }: { schedule: Schedule }) {
  if (schedule === "OTC") return null;
  return (
    <span className="ml-2 rounded bg-bad-soft px-1.5 py-0.5 align-middle text-xs font-semibold text-bad">{schedule}</span>
  );
}
