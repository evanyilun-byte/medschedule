// Prototype storage: everything stays in this browser (no server, no accounts).
import { DEFAULT_ROUTINE } from './scheduler.js';
import { addDays } from './refill.js';

const KEY = 'medschedule:v1';

// A household has one or more profiles (one per person cared for). There is
// no sign-in: profiles just keep each person's routine and medicines apart.
export function newProfile(name = '') {
  return { id: newId(), name, routine: { ...DEFAULT_ROUTINE }, medicines: [], taken: {} };
}

export function emptyState() {
  const p = newProfile();
  return { version: 2, profiles: [p], activeId: p.id, settings: {}, lastNumber: 0 };
}

export function activeProfile(state) {
  return state.profiles.find((p) => p.id === state.activeId) ?? state.profiles[0];
}

export function allMedicines(state) {
  return state.profiles.flatMap((p) => p.medicines);
}

// Each medicine keeps a permanent number that the caregiver writes on its
// packet. Numbers run across the whole household, so two people never have
// a packet with the same number, and are never reused or shuffled.
function maxNumber(medicines) {
  return medicines.reduce((max, m) => Math.max(max, m.number || 0), 0);
}

export function nextNumber(medicines) {
  return maxNumber(medicines) + 1;
}

// The household counter only goes up, so a number stays retired even after
// its medicine is deleted (its packet may still be in the cupboard).
export function takeNumber(state) {
  const n = Math.max(state.lastNumber || 0, maxNumber(allMedicines(state))) + 1;
  state.lastNumber = n;
  return n;
}

export function syncLastNumber(state) {
  state.lastNumber = Math.max(state.lastNumber || 0, maxNumber(allMedicines(state)));
}

export function assignNumbers(medicines, others = []) {
  const out = [];
  for (const m of medicines) out.push(m.number ? m : { ...m, number: nextNumber([...others, ...medicines, ...out]) });
  return out;
}

// Accepts any saved shape (v1 single person, or v2 profiles) → v2.
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return emptyState();
  let profiles;
  if (Array.isArray(raw.profiles) && raw.profiles.length) {
    profiles = raw.profiles;
  } else {
    profiles = [{
      id: newId(),
      name: raw.person?.name ?? '',
      routine: raw.person?.routine,
      medicines: raw.medicines ?? [],
      taken: raw.taken ?? {},
    }];
  }
  const done = [{ number: raw.lastNumber || 0 }];
  profiles = profiles.map((p) => {
    const medicines = assignNumbers(p.medicines ?? [], done);
    done.push(...medicines);
    return {
      id: p.id || newId(),
      name: p.name ?? '',
      routine: { ...DEFAULT_ROUTINE, ...p.routine },
      medicines,
      taken: p.taken ?? {},
    };
  });
  const activeId = profiles.some((p) => p.id === raw.activeId) ? raw.activeId : profiles[0].id;
  return { version: 2, profiles, activeId, settings: raw.settings ?? {}, lastNumber: maxNumber(done) };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : emptyState();
  } catch {
    return emptyState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false; // private mode or storage full (photos are the usual cause)
  }
}

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export function blankMedicine(today) {
  return {
    id: newId(),
    nameEn: '',
    strength: '',
    nicknameZh: '',
    photo: '',
    doseQty: 1,
    unit: 'tablet',
    frequency: 'BD',
    food: 'AFTER',
    prnReason: 'PRN_GENERIC',
    warnings: [],
    startDate: today,
    endDate: '',
    qtySupplied: null,
    dispensedOn: today,
    qtyAdjusted: null,
    adjustedOn: '',
    refillLeadDays: 7,
    status: 'confirmed',
  };
}

// Made-up example patient for demos; not real patient data. Numbers continue
// after any medicines other household members already have.
export function sampleMedicines(today, others = []) {
  const base = blankMedicine(today);
  const m = (over) => ({ ...base, id: newId(), ...over });
  return assignNumbers([
    m({ nameEn: 'Metformin', strength: '500mg', nicknameZh: '降血糖药', frequency: 'BD', food: 'AFTER', qtySupplied: 60, dispensedOn: addDays(today, -24) }),
    m({ nameEn: 'Amlodipine', strength: '5mg', nicknameZh: '降血压药', frequency: 'OM', food: 'NONE', qtySupplied: 90, dispensedOn: addDays(today, -10) }),
    m({ nameEn: 'Omeprazole', strength: '20mg', nicknameZh: '胃药', unit: 'capsule', frequency: 'OD', food: 'BEFORE', qtySupplied: 30, dispensedOn: addDays(today, -28), warnings: ['WARN_SWALLOW'] }),
    m({ nameEn: 'Atorvastatin', strength: '20mg', nicknameZh: '降胆固醇药', frequency: 'ON', food: 'NONE', qtySupplied: 90, dispensedOn: addDays(today, -30) }),
    m({ nameEn: 'Amoxicillin', strength: '500mg', nicknameZh: '消炎药', unit: 'capsule', frequency: 'TDS', food: 'AFTER', qtySupplied: 15, endDate: addDays(today, 4), warnings: ['WARN_COMPLETE'] }),
    m({ nameEn: 'Paracetamol', strength: '500mg', nicknameZh: '止痛药', doseQty: 2, frequency: 'PRN', food: 'AFTER', prnReason: 'PRN_PAIN', qtySupplied: 20 }),
  ], others);
}
