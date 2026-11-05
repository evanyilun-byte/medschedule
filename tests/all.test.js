import { test, eq } from './harness.js';
import { buildSchedule, doseTime, dosesPerDay, currentSlot, DEFAULT_ROUTINE, toHHMM, groupByTime, elderNow, groupStatus } from '../js/scheduler.js';
import { refillInfo, addDays, daysBetween } from '../js/refill.js';
import { zhQuantity, enQuantity, timingPhrase, FREQUENCIES, FOOD, doseAction, limitPhrase, takenWords } from '../js/phrases.js';

const R = DEFAULT_ROUTINE; // breakfast 07:00, lunch 12:00, dinner 18:30, bed 21:30
const TODAY = '2026-11-04';
const med = (over) => ({ id: 'm', nameEn: 'Test', doseQty: 1, unit: 'tablet', frequency: 'OD', food: 'AFTER', ...over });
const slotsOf = (sched) => sched.slots.map((s) => s.slot);

// --- scheduler: frequency → slots ---
const expectedSlots = {
  OM: ['morning'],
  OD: ['morning'],
  BD: ['morning', 'evening'],
  TDS: ['morning', 'noon', 'evening'],
  QDS: ['morning', 'noon', 'evening', 'bedtime'],
  ON: ['bedtime'],
  PRN: [],
};
for (const [freq, slots] of Object.entries(expectedSlots)) {
  test(`${freq} maps to ${slots.join(', ') || 'no fixed slots'}`, () => {
    eq(slotsOf(buildSchedule([med({ frequency: freq })], R, TODAY)), slots);
  });
}

// --- scheduler: every frequency × food combination yields valid times ---
for (const freq of Object.keys(FREQUENCIES)) {
  for (const food of Object.keys(FOOD)) {
    test(`${freq} + ${food} produces one dose per slot with HH:MM times`, () => {
      const sched = buildSchedule([med({ frequency: freq, food })], R, TODAY);
      const items = sched.slots.flatMap((s) => s.items);
      eq(items.length, dosesPerDay({ frequency: freq }));
      for (const i of items) eq(/^\d\d:\d\d$/.test(i.time), true, i.time);
    });
  }
}

test('food offsets: before = meal −30, after = meal +30, with = meal', () => {
  eq(doseTime('morning', 'BEFORE', R), '06:30');
  eq(doseTime('morning', 'AFTER', R), '07:30');
  eq(doseTime('evening', 'WITH', R), '18:30');
  eq(doseTime('noon', 'NONE', R), '12:00');
});

test('bedtime dose ignores food and uses bed time', () => {
  eq(doseTime('bedtime', 'AFTER', R), '21:30');
  eq(doseTime('bedtime', 'BEFORE', R), '21:30');
});

test('custom routine shifts times', () => {
  eq(doseTime('morning', 'AFTER', { ...R, breakfast: '08:15' }), '08:45');
});

test('toHHMM wraps past midnight', () => {
  eq(toHHMM(-30), '23:30');
  eq(toHHMM(1450), '00:10');
});

test('items within a slot are sorted by time', () => {
  const sched = buildSchedule(
    [med({ id: 'a', food: 'AFTER' }), med({ id: 'b', food: 'BEFORE' })],
    R,
    TODAY,
  );
  eq(sched.slots[0].items.map((i) => i.med.id), ['b', 'a']);
});

test('groupByTime: same time and meal wording share a heading', () => {
  const sched = buildSchedule(
    [
      med({ id: 'a', food: 'AFTER' }),
      med({ id: 'b', food: 'AFTER' }),
      med({ id: 'c', food: 'BEFORE' }),
      med({ id: 'd', food: 'NONE' }),
      med({ id: 'e', food: 'WITH' }), // same 07:00 as NONE, different wording
    ],
    R,
    TODAY,
  );
  const groups = groupByTime(sched.slots[0].items);
  eq(groups.map((g) => [g.time, g.food, g.items.map((i) => i.med.id)]), [
    ['06:30', 'BEFORE', ['c']],
    ['07:00', 'NONE', ['d']],
    ['07:00', 'WITH', ['e']],
    ['07:30', 'AFTER', ['a', 'b']],
  ]);
});

test('groupByTime: bedtime doses group together whatever the food code', () => {
  const sched = buildSchedule([med({ id: 'x', frequency: 'ON', food: 'AFTER' }), med({ id: 'y', frequency: 'ON', food: 'NONE' })], R, TODAY);
  eq(groupByTime(sched.slots[0].items).map((g) => g.items.length), [2]);
});

// --- elder "Now" screen ---
const day = buildSchedule(
  [med({ id: 'bp', frequency: 'OM', food: 'NONE' }), med({ id: 'dm', frequency: 'BD', food: 'AFTER' }), med({ id: 'st', frequency: 'ON' })],
  R,
  TODAY,
); // morning: bp 07:00, dm 07:30 · evening: dm 19:00 · bedtime: st 21:30
const tick = (...keys) => Object.fromEntries(keys.map((k) => [k, true]));

test('elderNow: early morning shows morning, nothing missed', () => {
  eq(elderNow(day, R, '05:00', {}), { slot: 'morning', missed: [], allDone: false });
});

test('elderNow: skips a part of the day that is already fully ticked', () => {
  eq(elderNow(day, R, '07:45', tick('bp:morning', 'dm:morning')).slot, 'evening');
});

test('elderNow: lunchtime with no noon medicines shows the next part (evening)', () => {
  eq(elderNow(day, R, '12:00', tick('bp:morning', 'dm:morning')).slot, 'evening');
});

test('elderNow: unticked earlier doses are reported as missed', () => {
  eq(elderNow(day, R, '15:00', tick('bp:morning')).missed, [{ slot: 'morning', count: 1 }]);
});

test('elderNow: after bedtime nothing is left; missed and all-done are reported', () => {
  eq(elderNow(day, R, '23:00', tick('bp:morning', 'dm:morning', 'dm:evening')), {
    slot: null, missed: [{ slot: 'bedtime', count: 1 }], allDone: false,
  });
  eq(elderNow(day, R, '23:00', tick('bp:morning', 'dm:morning', 'dm:evening', 'st:bedtime')).allDone, true);
});

test('groupStatus: "now" from 30 minutes before the dose time', () => {
  eq(['06:59', '07:00', '07:30', '09:00'].map((t) => groupStatus('07:30', t)), ['later', 'now', 'now', 'now']);
});

test('PRN medicines go to the as-needed list only', () => {
  const sched = buildSchedule([med({ id: 'p', frequency: 'PRN' })], R, TODAY);
  eq(sched.slots.length, 0);
  eq(sched.asNeeded.map((m) => m.id), ['p']);
});

test('stopped, ended and not-yet-started medicines are excluded', () => {
  const sched = buildSchedule(
    [
      med({ id: 'stopped', status: 'stopped' }),
      med({ id: 'ended', endDate: '2026-11-03' }),
      med({ id: 'future', startDate: '2026-11-05' }),
      med({ id: 'lastday', endDate: TODAY }),
    ],
    R,
    TODAY,
  );
  eq(sched.slots.flatMap((s) => s.items.map((i) => i.med.id)), ['lastday']);
});

test('currentSlot picks the upcoming part of the day', () => {
  eq(currentSlot(R, '05:00'), 'morning');
  eq(currentSlot(R, '07:59'), 'morning');
  eq(currentSlot(R, '08:01'), 'noon');
  eq(currentSlot(R, '15:00'), 'evening');
  eq(currentSlot(R, '21:00'), 'bedtime');
  eq(currentSlot(R, '23:30'), 'morning');
});

// --- phrases ---
test('Chinese quantities', () => {
  eq(zhQuantity(1, 'tablet'), '一粒');
  eq(zhQuantity(2, 'tablet'), '两粒');
  eq(zhQuantity(0.5, 'tablet'), '半粒');
  eq(zhQuantity(1.5, 'tablet'), '一粒半');
  eq(zhQuantity(10, 'ml'), '十毫升');
});

test('English quantities', () => {
  eq(enQuantity(1, 'tablet'), '1 tablet');
  eq(enQuantity(2, 'capsule'), '2 capsules');
  eq(enQuantity(0.5, 'tablet'), '½ tablet');
  eq(enQuantity(1.5, 'tablet'), '1½ tablets');
});

test('timing phrases', () => {
  eq(timingPhrase('morning', 'AFTER'), { en: 'After breakfast', zh: '早餐后' });
  eq(timingPhrase('evening', 'BEFORE'), { en: 'Before dinner', zh: '晚餐前' });
  eq(timingPhrase('bedtime', 'AFTER'), { en: 'Bedtime', zh: '睡前' });
  eq(timingPhrase('noon', 'NONE'), { en: 'Noon', zh: '中午' });
});

test('dose verbs: never "eat" a drop or a puff', () => {
  const act = (over) => doseAction({ doseQty: 1, ...over });
  eq(act({ unit: 'tablet' }), { zh: '吃一粒', en: 'Take 1 tablet', complete: true });
  eq(act({ unit: 'ml', doseQty: 10 }).zh, '喝十毫升');
  eq(act({ unit: 'sachet' }).zh, '服一包');
  eq(act({ unit: 'drop', route: 'eye', side: 'both' }), { zh: '每只眼滴一滴', en: '1 drop in each eye', complete: true });
  eq(act({ unit: 'drop', route: 'eye', side: 'left' }).zh, '左眼滴一滴');
  eq(act({ unit: 'drop', route: 'ear', side: 'right', doseQty: 2 }).en, '2 drops in the right ear');
  eq(act({ unit: 'drop', route: 'nose' }).zh, '鼻子滴一滴');
  eq(act({ unit: 'puff', route: 'mouth', doseQty: 2 }), { zh: '吸两喷', en: 'Inhale 2 puffs', complete: true });
  eq(act({ unit: 'puff', route: 'nose' }).zh, '鼻子喷一喷');
  // no route yet: neutral words, marked incomplete so the form insists
  eq(act({ unit: 'drop' }).complete, false);
  eq(act({ unit: 'puff' }).zh.startsWith('吃'), false);
  for (const unit of ['drop', 'puff']) for (const route of ['eye', 'ear', 'nose', 'mouth', '']) {
    eq(act({ unit, route, side: 'both' }).zh.includes('吃'), false, `${unit}/${route}`);
  }
});

test('tick button words follow the verb', () => {
  eq([takenWords('tablet').ask, takenWords('ml').ask, takenWords('drop').ask, takenWords('puff').done], ['我吃了', '我喝了', '我用了', '✓ 用了']);
});

test('limit wording only when the label gives one', () => {
  eq(limitPhrase({ unit: 'tablet', maxPerDay: 8, minHours: 4 }), { zh: '一天最多八粒，每次隔四小时', en: 'Max 8 tablets a day · At least 4 hours apart' });
  eq(limitPhrase({ unit: 'tablet', maxPerDay: null, minHours: null }), null);
});

// --- refill ---
const refillMed = (over) => med({ frequency: 'BD', qtySupplied: 60, dispensedOn: '2026-11-01', ...over });

test('date helpers', () => {
  eq(addDays('2026-12-30', 3), '2027-01-02');
  eq(daysBetween('2026-11-01', '2026-12-01'), 30);
});

test('60 tablets, 1 tablet twice a day → runs out after 30 days', () => {
  const info = refillInfo(refillMed(), TODAY);
  eq(info.runOut, '2026-12-01');
  eq(info.remindOn, '2026-11-24');
  eq(info.daysLeft, 27);
  eq(info.status, 'ok');
});

test('per-day maths for every scheduled frequency', () => {
  const perDay = { OM: 1, OD: 1, BD: 2, TDS: 3, QDS: 4, ON: 1 };
  for (const [freq, n] of Object.entries(perDay)) {
    const info = refillInfo(refillMed({ frequency: freq, qtySupplied: 120 }), TODAY);
    eq(info.runOut, addDays('2026-11-01', Math.floor(120 / n)), freq);
  }
});

test('2 tablets per dose doubles usage', () => {
  eq(refillInfo(refillMed({ doseQty: 2 }), TODAY).runOut, '2026-11-16');
});

test('half-tablet doses', () => {
  // ½ tablet once a day, 30 tablets → 60 days
  const info = refillInfo(refillMed({ frequency: 'OD', doseQty: 0.5, qtySupplied: 30 }), TODAY);
  eq(info.runOut, '2026-12-31');
});

test('PRN → no refill reminder', () => {
  eq(refillInfo(refillMed({ frequency: 'PRN' }), TODAY), null);
});

test('missing quantity or dispense date → no reminder', () => {
  eq(refillInfo(refillMed({ qtySupplied: null }), TODAY), null);
  eq(refillInfo(refillMed({ dispensedOn: '' }), TODAY), null);
});

test('short course that ends before run-out → no reminder', () => {
  eq(refillInfo(refillMed({ endDate: '2026-11-06' }), TODAY), null);
});

test('manual count overrides label quantity', () => {
  const info = refillInfo(refillMed({ qtyAdjusted: 10, adjustedOn: TODAY }), TODAY);
  eq(info.runOut, '2026-11-09');
  eq(info.status, 'soon');
});

test('status thresholds: soon / urgent / out', () => {
  eq(refillInfo(refillMed(), '2026-11-25').status, 'soon');
  eq(refillInfo(refillMed(), '2026-11-29').status, 'urgent');
  eq(refillInfo(refillMed(), '2026-12-01').status, 'out');
  eq(refillInfo(refillMed({ qtyAdjusted: 0, adjustedOn: TODAY }), TODAY).status, 'out');
});

test('custom lead time', () => {
  eq(refillInfo(refillMed({ refillLeadDays: 14 }), TODAY).remindOn, '2026-11-17');
});
