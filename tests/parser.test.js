import { test, eq } from './harness.js';
import { parseLabelText, cleanText } from '../js/labelParser.js';
import { normalizeLabel } from '../js/extract.js';
import { zhNumber } from '../js/phrases.js';
import { nextNumber, assignNumbers, migrate, sampleMedicines, activeProfile, allMedicines, takeNumber, emptyState } from '../js/storage.js';

// Mock labels in the styles used by Singapore clinics (made-up patients).
const POLYCLINIC = `
TAMPINES POLYCLINIC
TAN AH MA                 05/11/2026
METFORMIN 500MG TABLET
TAKE 1 TABLET(S) 2 TIME(S) A DAY AFTER FOOD
QTY: 60 TAB
KEEP OUT OF REACH OF CHILDREN`;

const GP_ABBREV = `
Sunshine Family Clinic  Tel 6123 4567
Amlodipine 5 mg
1 tab OM
30 TABS   Date: 2-11-26`;

const HOSPITAL_PRN = `
GENERAL HOSPITAL PHARMACY
PARACETAMOL 500MG TAB
TAKE 2 TABLETS 4 TIMES A DAY WHEN NECESSARY FOR PAIN
20 TABLETS  12 OCT 2026`;

const ANTIBIOTIC = `
AMOXICILLIN 500MG CAPSULE
TAKE 1 CAPSULE 3 TIMES A DAY AFTER FOOD FOR 5 DAYS
COMPLETE THE WHOLE COURSE
QTY 15 CAP`;

const NIGHT_DROWSY = `
CHLORPHENAMINE 4MG TABLET
TAKE 1 TABLET AT NIGHT
MAY CAUSE DROWSINESS. AVOID ALCOHOL
10 TAB`;

const pick = (r, keys) => Object.fromEntries(keys.map((k) => [k, r[k]]));
const CORE = ['medicine_name', 'strength', 'dose_qty', 'unit', 'frequency', 'food'];

test('parser: polyclinic label', () => {
  const r = parseLabelText(POLYCLINIC);
  eq(pick(r, CORE), { medicine_name: 'Metformin', strength: '500mg', dose_qty: 1, unit: 'tablet', frequency: 'BD', food: 'AFTER' });
  eq(r.quantity_supplied, 60);
  eq(r.dispensed_on, '2026-11-05');
  eq(r.uncertain_fields, []);
  eq(r.instruction_text, 'TAKE 1 TABLET(S) 2 TIME(S) A DAY AFTER FOOD');
});

test('parser: GP label with abbreviations, no "take"', () => {
  const r = parseLabelText(GP_ABBREV);
  eq(r.medicine_name, 'Amlodipine');
  eq(r.strength, '5mg');
  eq(r.frequency, 'OM');
  eq(r.quantity_supplied, 30);
  eq(r.dispensed_on, '2026-11-02');
  // No "TAKE n TAB" phrase → dose flagged for the caregiver.
  eq(r.uncertain_fields.includes('dose_qty'), true);
});

test('parser: "when necessary" wins over the frequency → PRN with reason', () => {
  const r = parseLabelText(HOSPITAL_PRN);
  eq([r.frequency, r.prn_reason, r.dose_qty], ['PRN', 'PRN_PAIN', 2]);
  eq(r.dispensed_on, '2026-10-12');
  eq(r.uncertain_fields.includes('food'), false);
});

test('parser: instruction text keeps a continuation line', () => {
  eq(parseLabelText('METFORMIN 500MG\nTAKE 1 TABLET 2 TIMES A DAY\nAFTER FOOD\nQTY 60').instruction_text, 'TAKE 1 TABLET 2 TIMES A DAY AFTER FOOD');
});

test('parser: antibiotic course length and warning', () => {
  const r = parseLabelText(ANTIBIOTIC);
  eq([r.unit, r.frequency, r.food, r.duration_days, r.quantity_supplied], ['capsule', 'TDS', 'AFTER', 5, 15]);
  eq(r.warnings, ['WARN_COMPLETE']);
});

test('parser: night-time dose and warnings', () => {
  const r = parseLabelText(NIGHT_DROWSY);
  eq(r.frequency, 'ON');
  eq(r.warnings, ['WARN_DROWSY', 'WARN_NO_ALCOHOL']);
  eq(r.uncertain_fields.includes('food'), true); // label says nothing about food
});

test('parser: frequency wording variants', () => {
  const freq = (s) => parseLabelText(`PANADOL 500MG\n${s}`).frequency;
  eq(freq('TAKE 1 TABLET ONCE A DAY'), 'OD');
  eq(freq('TAKE 1 TABLET TWICE DAILY'), 'BD');
  eq(freq('TAKE 1 TABLET EVERY MORNING'), 'OM');
  eq(freq('TAKE 1 TABLET ONCE A DAY IN THE MORNING'), 'OM');
  eq(freq('TAKE 1 TABLET BEFORE BED'), 'ON');
  eq(freq('1 TAB TDS PC'), 'TDS');
  eq(freq('1 TAB BID'), 'BD');
  eq(freq('1 TAB QID'), 'QDS');
  eq(freq('1 TAB ON'), 'ON');
  eq(freq('TAKE 2 TABLETS AS NEEDED'), 'PRN');
});

test('parser: conflicting frequencies are left blank and flagged', () => {
  const r = parseLabelText('PANADOL 500MG\nTAKE 1 TABLET BD TDS');
  eq(r.frequency, null);
  eq(r.uncertain_fields.includes('frequency'), true);
});

test('parser: food wording variants', () => {
  const food = (s) => parseLabelText(`PANADOL 500MG\nTAKE 1 TABLET BD ${s}`).food;
  eq(food('AFTER MEALS'), 'AFTER');
  eq(food('PC'), 'AFTER');
  eq(food('BEFORE FOOD'), 'BEFORE');
  eq(food('ON AN EMPTY STOMACH'), 'BEFORE');
  eq(food('WITH FOOD'), 'WITH');
  eq(food(''), 'NONE');
});

test('parser: dose words and halves', () => {
  const dose = (s) => parseLabelText(`PANADOL 500MG\n${s} BD`).dose_qty;
  eq(dose('TAKE HALF TABLET'), 0.5);
  eq(dose('TAKE 1/2 TABLET'), 0.5);
  eq(dose('TAKE ONE TABLET'), 1);
  eq(dose('TAKE 2 TABS'), 2);
  eq(parseLabelText('SALBUTAMOL 100MCG INHALER\nINHALE 2 PUFFS WHEN NEEDED').unit, 'puff');
});

test('parser: OCR slips are tidied (O for 0, I for 1)', () => {
  eq(cleanText('metformin 5O0mg\ntake I tab bd'), 'METFORMIN 500MG\nTAKE 1 TAB BD');
  eq(parseLabelText('METFORMIN 5O0MG\nTAKE I TAB BD AFTER FOOD').dose_qty, 1);
});

test('parser: clinic/patient lines are not mistaken for the drug name', () => {
  eq(parseLabelText('DR LIM 50MG CLINIC\nASPIRIN 100MG\nTAKE 1 TAB OD').medicine_name, 'Aspirin');
});

test('parser: not a label → unreadable', () => {
  eq(parseLabelText('HELLO WORLD\nRECEIPT TOTAL $12.40'), { readable: false });
  eq(parseLabelText(''), { readable: false });
});

test('parser: blurry photo (low OCR confidence) flags everything', () => {
  const r = parseLabelText(POLYCLINIC, 45);
  for (const f of ['medicine_name', 'dose_qty', 'frequency', 'food', 'quantity_supplied']) eq(r.uncertain_fields.includes(f), true, f);
  eq(typeof r.notes, 'string');
});

test('parser output passes through normalizeLabel into form values', () => {
  const r = normalizeLabel(parseLabelText(ANTIBIOTIC), '2026-11-05');
  eq(r.values.frequency, 'TDS');
  eq(r.values.endDate, '2026-11-09');
  eq(r.values.warnings, ['WARN_COMPLETE']);
});

// --- medicine numbers ---
test('Chinese numbers for "N号药"', () => {
  eq([1, 2, 9, 10, 11, 12, 20, 25].map(zhNumber), ['一', '二', '九', '十', '十一', '十二', '二十', '二十五']);
});

test('numbers are assigned once and never reused', () => {
  eq(nextNumber([]), 1);
  eq(nextNumber([{ number: 1 }, { number: 4 }]), 5); // gap after a deletion stays a gap
  const out = assignNumbers([{ id: 'a' }, { id: 'b', number: 3 }, { id: 'c' }]);
  eq(out.map((m) => m.number), [4, 3, 5]);
  eq(assignNumbers(out).map((m) => m.number), [4, 3, 5]); // stable on reload
});

// --- profiles ---
test('migrate: old single-person data becomes one profile, nothing lost', () => {
  const v1 = {
    person: { name: 'Ah Ma', routine: { breakfast: '08:00' } },
    medicines: [{ id: 'a', nameEn: 'Metformin', number: 1 }, { id: 'b', nameEn: 'Aspirin' }],
    taken: { '2026-11-05': { 'a:morning': true } },
    settings: { elderBilingual: true },
  };
  const s = migrate(v1);
  eq(s.version, 2);
  eq(s.profiles.length, 1);
  const p = activeProfile(s);
  eq([p.name, p.routine.breakfast, p.routine.bed], ['Ah Ma', '08:00', '21:30']);
  eq(p.medicines.map((m) => [m.id, m.number]), [['a', 1], ['b', 2]]);
  eq(p.taken, v1.taken);
  eq(s.settings, { elderBilingual: true });
});

test('migrate: numbers are unique across the household', () => {
  const s = migrate({
    profiles: [
      { id: 'ma', name: 'Ah Ma', medicines: [{ id: 'a', number: 1 }, { id: 'b' }] },
      { id: 'gong', name: 'Ah Gong', medicines: [{ id: 'c' }, { id: 'd', number: 7 }] },
    ],
    activeId: 'gong',
  });
  const nums = allMedicines(s).map((m) => m.number);
  eq(nums, [1, 2, 8, 7]);
  eq(new Set(nums).size, nums.length);
  eq(activeProfile(s).name, 'Ah Gong');
});

test('migrate: unknown active profile falls back to the first; junk gives a fresh start', () => {
  eq(migrate({ profiles: [{ id: 'x', medicines: [] }], activeId: 'gone' }).activeId, 'x');
  eq(migrate(null).profiles.length, 1);
  eq(migrate('nonsense').profiles[0].medicines, []);
});

test('example patient numbers continue after other household members', () => {
  const meds = sampleMedicines('2026-11-05', [{ number: 1 }, { number: 2 }, { number: 3 }]);
  eq(meds.map((m) => m.number), [4, 5, 6, 7, 8, 9]);
});

test('numbers stay retired after medicines are removed', () => {
  const s = emptyState();
  const p = activeProfile(s);
  p.medicines = [{ id: 'a', number: takeNumber(s) }, { id: 'b', number: takeNumber(s) }];
  eq(p.medicines.map((m) => m.number), [1, 2]);
  p.medicines = []; // "Remove all medicines"
  eq(takeNumber(s), 3);
});

test('migrate keeps the counter so old numbers are not handed out again', () => {
  const s = migrate({ profiles: [{ id: 'x', medicines: [{ id: 'a', number: 2 }] }], lastNumber: 9 });
  eq(s.lastNumber, 9);
  eq(takeNumber(s), 10);
  eq(migrate({ person: { name: '' }, medicines: [{ id: 'a' }, { id: 'b' }] }).lastNumber, 2);
});
