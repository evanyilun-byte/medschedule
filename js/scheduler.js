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
