// Prototype storage: everything stays in this browser (no server, no accounts).
import { DEFAULT_ROUTINE } from './scheduler.js';
import { addDays } from './refill.js';

const KEY = 'medschedule:v1';

export function emptyState() {
  return { person: { name: '', routine: { ...DEFAULT_ROUTINE } }, medicines: [], taken: {} };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const state = { ...emptyState(), ...JSON.parse(raw) };
    state.person.routine = { ...DEFAULT_ROUTINE, ...state.person.routine };
    return state;
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

// Made-up example patient for demos; not real patient data.
export function sampleState(today) {
  const base = blankMedicine(today);
  const m = (over) => ({ ...base, id: newId(), ...over });
  return {
    person: { name: 'Ah Ma', routine: { ...DEFAULT_ROUTINE } },
    taken: {},
    medicines: [
      m({ nameEn: 'Metformin', strength: '500mg', nicknameZh: '降血糖药', frequency: 'BD', food: 'AFTER', qtySupplied: 60, dispensedOn: addDays(today, -24) }),
      m({ nameEn: 'Amlodipine', strength: '5mg', nicknameZh: '降血压药', frequency: 'OM', food: 'NONE', qtySupplied: 90, dispensedOn: addDays(today, -10) }),
      m({ nameEn: 'Omeprazole', strength: '20mg', nicknameZh: '胃药', unit: 'capsule', frequency: 'OD', food: 'BEFORE', qtySupplied: 30, dispensedOn: addDays(today, -28), warnings: ['WARN_SWALLOW'] }),
      m({ nameEn: 'Atorvastatin', strength: '20mg', nicknameZh: '降胆固醇药', frequency: 'ON', food: 'NONE', qtySupplied: 90, dispensedOn: addDays(today, -30) }),
      m({ nameEn: 'Amoxicillin', strength: '500mg', nicknameZh: '消炎药', unit: 'capsule', frequency: 'TDS', food: 'AFTER', qtySupplied: 15, endDate: addDays(today, 4), warnings: ['WARN_COMPLETE'] }),
      m({ nameEn: 'Paracetamol', strength: '500mg', nicknameZh: '止痛药', doseQty: 2, frequency: 'PRN', food: 'AFTER', prnReason: 'PRN_PAIN', qtySupplied: 20 }),
    ],
  };
}
