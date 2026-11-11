import * as chrono from "chrono-node";
import { DateTime } from "luxon";

// The browser supplies an IANA zone; UTC instants are the database contract.
export function validZone(zone: string) {
  return DateTime.now().setZone(zone).isValid;
}
export function timeContext(question: string, zone: string, now = new Date()) {
  const local = DateTime.fromJSDate(now, { zone });
  const matches = chrono.parse(
    question,
    { instant: now, timezone: local.offset },
    { forwardDate: false },
  );
  const date = matches.find(
    (m) => m.start.isCertain("day") || m.start.isCertain("weekday"),
  );
  if (!date) return { today: local.toISODate()!, now: local.toISO()!, zone };
  let day = DateTime.fromObject(
    {
      year: date.start.get("year")!,
      month: date.start.get("month")!,
      day: date.start.get("day")!,
    },
    { zone },
  );
  // Bare dates in historical questions mean the latest occurrence, not next year.
  if (
    !date.start.isCertain("year") &&
    day > local &&
    /asked|last|on|shortlisted|remember/i.test(question)
  )
    day = day.minus({ years: 1 });
  return {
    today: local.toISODate()!,
    now: local.toISO()!,
    zone,
    mentionedDate: day.toISODate()!,
    start: day.startOf("day").toUTC().toISO()!,
    end: day.plus({ days: 1 }).startOf("day").toUTC().toISO()!,
  };
}
