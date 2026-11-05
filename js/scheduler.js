// Pure scheduling logic: (medicines, routine, today) → daily schedule.
// No AI and no I/O here, so it can be tested exhaustively.
import { FREQUENCIES, FOOD, SLOTS, SLOT_ORDER } from './phrases.js';

export const DEFAULT_ROUTINE = {
  wake: '06:30',
  breakfast: '07:00',
  lunch: '12:00',
  dinner: '18:30',
  bed: '21:30',
};

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function toHHMM(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function dosesPerDay(med) {
  return FREQUENCIES[med.frequency]?.slots.length ?? 0;
}

export function isActive(med, today) {
  if (med.status === 'stopped') return false;
  if (med.startDate && today < med.startDate) return false;
  if (med.endDate && today > med.endDate) return false;
  return true;
}

// Clock time for one dose. Bedtime and "any time" doses ignore the food offset.
export function doseTime(slot, foodCode, routine) {
  const meal = SLOTS[slot].meal;
  if (!meal) return toHHMM(toMinutes(routine.bed));
  const offset = FOOD[foodCode]?.offset ?? 0;
  return toHHMM(toMinutes(routine[meal]) + (foodCode === 'NONE' ? 0 : offset));
}

export function buildSchedule(medicines, routine, today) {
  const active = medicines.filter((m) => isActive(m, today));
  const slots = SLOT_ORDER.map((slot) => ({ slot, items: [] }));

  for (const med of active) {
    for (const slot of FREQUENCIES[med.frequency]?.slots ?? []) {
      slots
        .find((s) => s.slot === slot)
        .items.push({ med, slot, time: doseTime(slot, med.food, routine) });
    }
  }
  for (const s of slots) s.items.sort((a, b) => a.time.localeCompare(b.time));

  return {
    slots: slots.filter((s) => s.items.length > 0),
    asNeeded: active.filter((m) => m.frequency === 'PRN'),
  };
}

// Doses at the same time with the same meal wording share one heading, so
// "早餐后 7:30" is said once instead of on every row. Keeps time order.
export function groupByTime(items) {
  const groups = new Map();
  for (const item of items) {
    const food = !SLOTS[item.slot].meal || item.med.food === 'NONE' ? 'NONE' : item.med.food;
    const key = `${item.time}|${food}`;
    if (!groups.has(key)) groups.set(key, { time: item.time, slot: item.slot, food, items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

// What the elder's "Now" screen shows. Picks the current part of the day,
// skips ahead past a part that is fully ticked, and lists earlier parts that
// still have unticked doses (shown as information only — the app never says
// to take a missed dose late).
//   slot:    part of the day to show, or null when nothing is left today
//   missed:  [{ slot, count }] earlier parts with unticked doses
//   allDone: every dose today is ticked
export function elderNow(schedule, routine, nowHHMM, taken) {
  const isTaken = (i) => !!taken[`${i.med.id}:${i.slot}`];
  const now = toMinutes(nowHHMM);
  const dayOver = now > toMinutes(routine.bed) + 60;
  const from = dayOver ? SLOT_ORDER.length : SLOT_ORDER.indexOf(currentSlot(routine, nowHHMM));
  const order = (s) => SLOT_ORDER.indexOf(s.slot);

  const missed = schedule.slots
    .filter((s) => order(s) < from)
    .map((s) => ({ slot: s.slot, count: s.items.filter((i) => !isTaken(i)).length }))
    .filter((m) => m.count > 0);
  const next = schedule.slots.find((s) => order(s) >= from && s.items.some((i) => !isTaken(i)));
  const allDone = schedule.slots.every((s) => s.items.every(isTaken));
  return { slot: next?.slot ?? null, missed, allDone };
}

// "now" once it is within 30 minutes of the dose time, otherwise "later".
export function groupStatus(groupTime, nowHHMM) {
  return toMinutes(nowHHMM) >= toMinutes(groupTime) - 30 ? 'now' : 'later';
}

// Which slot the elder should look at right now: the next one not yet
// past by more than an hour, wrapping to morning after bedtime.
export function currentSlot(routine, nowHHMM) {
  const now = toMinutes(nowHHMM);
  const anchors = {
    morning: toMinutes(routine.breakfast),
    noon: toMinutes(routine.lunch),
    evening: toMinutes(routine.dinner),
    bedtime: toMinutes(routine.bed),
  };
  return SLOT_ORDER.find((slot) => now <= anchors[slot] + 60) ?? 'morning';
}
