// Refill reminders: when will each medicine run out, and when to warn.
import { dosesPerDay } from './scheduler.js';

const DAY_MS = 86400000;

// Dates are 'YYYY-MM-DD' strings handled in UTC so day arithmetic is exact.
export function addDays(date, days) {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

// Returns null when no refill reminder applies: "only when needed"
// medicines, missing quantity, or short courses that end first.
export function refillInfo(med, today) {
  if (med.frequency === 'PRN' || med.status === 'stopped') return null;
  const start = med.adjustedOn || med.dispensedOn;
  const remaining = med.adjustedOn ? med.qtyAdjusted : med.qtySupplied;
  const perDay = (med.doseQty || 0) * dosesPerDay(med);
  if (!start || remaining == null || remaining === '' || !perDay) return null;

  const runOut = addDays(start, Math.floor(remaining / perDay));
  if (med.endDate && med.endDate < runOut) return null;

  const leadDays = med.refillLeadDays ?? 7;
  const remindOn = addDays(runOut, -leadDays);
  const daysLeft = daysBetween(today, runOut);
  const status = daysLeft <= 0 ? 'out' : daysLeft <= 2 ? 'urgent' : today >= remindOn ? 'soon' : 'ok';
  return { runOut, remindOn, daysLeft, status };
}

// Calendar file so the caregiver's phone gives a real reminder.
export function refillIcs(med, info) {
  const d = info.remindOn.replaceAll('-', '');
  const next = addDays(info.remindOn, 1).replaceAll('-', '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MedSchedule//EN',
    'BEGIN:VEVENT',
    `UID:refill-${med.id}-${d}@medschedule`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${d}`,
    `DTEND;VALUE=DATE:${next}`,
    `SUMMARY:Refill ${med.nameEn} (runs out ${info.runOut})`,
    'DESCRIPTION:Book a clinic or pharmacy visit to collect more.',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
