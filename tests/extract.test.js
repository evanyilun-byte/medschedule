import { test, eq } from './harness.js';
import { normalizeLabel } from '../js/extract.js';

const TODAY = '2026-11-04';
const good = {
  readable: true,
  medicine_name: 'Metformin',
  strength: '500mg',
  dose_qty: 1,
  unit: 'tablet',
  frequency: 'BD',
  food: 'AFTER',
  prn_reason: null,
  warnings: [],
  quantity_supplied: 60,
  dispensed_on: '2026-11-01',
  duration_days: null,
  uncertain_fields: [],
  instruction_text: 'Take 1 tablet 2 times a day after food',
  notes: null,
};
const norm = (over) => normalizeLabel({ ...good, ...over }, TODAY);

test('label: clean result maps straight to form values', () => {
  const r = norm({});
  eq(r.values.nameEn, 'Metformin');
  eq(r.values.doseQty, 1);
  eq(r.values.frequency, 'BD');
  eq(r.values.food, 'AFTER');
  eq(r.values.qtySupplied, 60);
  eq(r.values.dispensedOn, '2026-11-01');
  eq(r.values.startDate, '2026-11-01');
  eq(r.values.endDate, '');
  eq([...r.uncertain], []);
  eq(r.instructionText, 'Take 1 tablet 2 times a day after food');
});

test('label: unreadable photo', () => {
  eq(normalizeLabel({ ...good, readable: false }, TODAY), { unreadable: true });
  eq(normalizeLabel(null, TODAY), { unreadable: true });
});

test('label: model-reported uncertain fields are mapped to form names', () => {
  eq([...norm({ uncertain_fields: ['food', 'quantity_supplied', 'bogus'] }).uncertain], ['food', 'qtySupplied']);
});

test('label: missing name is flagged', () => {
  eq(norm({ medicine_name: null }).uncertain.has('nameEn'), true);
});

test('label: unknown codes are left BLANK (not a plausible default) and flagged', () => {
  const r = norm({ frequency: 'Q6H', food: 'SOMETIMES', unit: 'spoon', dose_qty: null });
  eq([r.values.frequency, r.values.food, r.values.unit, r.values.doseQty], ['', '', '', null]);
  eq(['frequency', 'food', 'unit', 'doseQty'].every((f) => r.uncertain.has(f)), true);
});

test('label: drops need where they go; eye and ear also need a side', () => {
  const ok = norm({ unit: 'drop', route: 'eye', side: 'left' });
  eq([ok.values.route, ok.values.side, ok.uncertain.has('route')], ['eye', 'left', false]);
  const noRoute = norm({ unit: 'drop', route: null });
  eq([noRoute.values.route, noRoute.uncertain.has('route')], ['', true]);
  const noSide = norm({ unit: 'drop', route: 'ear', side: null });
  eq([noSide.values.side, noSide.uncertain.has('side')], ['', true]);
  eq(norm({ unit: 'puff', route: 'nose' }).values.side, '');
  eq(norm({ unit: 'tablet', route: 'eye' }).values.route, ''); // tablets have no route
});

test('label: when-needed limits are kept only if sensible, and always flagged', () => {
  const r = norm({ frequency: 'PRN', prn_reason: 'PRN_PAIN', max_per_day: 8, min_hours: 4 });
  eq([r.values.maxPerDay, r.values.minHours], [8, 4]);
  eq([r.uncertain.has('maxPerDay'), r.uncertain.has('minHours')], [true, true]);
  const none = norm({ frequency: 'PRN', prn_reason: 'PRN_PAIN', max_per_day: null });
  eq([none.values.maxPerDay, none.uncertain.has('maxPerDay')], [null, true]); // missing limit is flagged
  eq(norm({ frequency: 'PRN', max_per_day: 500 }).values.maxPerDay, null);
  eq(norm({ max_per_day: 8 }).values.maxPerDay, null); // only for when-needed medicines
});

test('label: odd doses are flagged (0, negative, 0.3, huge)', () => {
  for (const d of [0, -1, 0.3, 50, null]) eq(norm({ dose_qty: d }).uncertain.has('doseQty'), true, String(d));
  eq(norm({ dose_qty: 0.5 }).values.doseQty, 0.5);
});

test('label: PRN keeps its reason, others do not', () => {
  eq(norm({ frequency: 'PRN', prn_reason: 'PRN_PAIN' }).values.prnReason, 'PRN_PAIN');
  eq(norm({ frequency: 'PRN', prn_reason: null }).uncertain.has('prnReason'), true);
  eq('prnReason' in norm({}).values, false);
});

test('label: unknown warnings are dropped and flagged', () => {
  const r = norm({ warnings: ['WARN_DROWSY', 'WARN_MADE_UP', 'WARN_DROWSY'] });
  eq(r.values.warnings, ['WARN_DROWSY']);
  eq(r.uncertain.has('warnings'), true);
});

test('label: future or ancient dispense date is replaced by today and flagged', () => {
  for (const d of ['2026-12-01', '2020-01-01', '01/11/2026']) {
    const r = norm({ dispensed_on: d });
    eq(r.values.dispensedOn, TODAY, d);
    eq(r.uncertain.has('dispensedOn'), true, d);
  }
});

test('label: missing dispense date defaults to today without a flag', () => {
  const r = norm({ dispensed_on: null });
  eq(r.values.dispensedOn, TODAY);
  eq(r.uncertain.has('dispensedOn'), false);
});

test('label: course length becomes an end date (inclusive)', () => {
  eq(norm({ duration_days: 5 }).values.endDate, '2026-11-05');
  eq(norm({ duration_days: 0 }).values.endDate, '');
});

test('label: impossible quantity is dropped', () => {
  eq(norm({ quantity_supplied: -5 }).values.qtySupplied, null);
  eq(norm({ quantity_supplied: 99999 }).values.qtySupplied, null);
});
