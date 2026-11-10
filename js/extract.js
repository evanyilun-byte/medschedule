// Label reading: read a photo (free on-device OCR by default, or the optional
// AI backend), then turn the answer into medicine form values. Anything
// unknown, missing or odd is flagged for the caregiver instead of trusted.
import { FREQUENCIES, FOOD, UNITS, PRN_REASONS, WARNINGS, ROUTES, SIDES, needsRoute } from './phrases.js';
import { addDays } from './refill.js';
import { READ_LABEL_URL } from './config.js';
import { parseLabelText } from './labelParser.js';
import { recognizeLabel } from './ocr.js';

// Backend field name → medicine form field name.
const FIELD_MAP = {
  medicine_name: 'nameEn',
  strength: 'strength',
  dose_qty: 'doseQty',
  unit: 'unit',
  frequency: 'frequency',
  food: 'food',
  prn_reason: 'prnReason',
  warnings: 'warnings',
  quantity_supplied: 'qtySupplied',
  dispensed_on: 'dispensedOn',
  duration_days: 'endDate',
  route: 'route',
  side: 'side',
  max_per_day: 'maxPerDay',
  min_hours: 'minHours',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s) {
  return typeof s === 'string' && ISO_DATE.test(s) && !Number.isNaN(Date.parse(s));
}

// Returns { values, uncertain, instructionText, notes } or { unreadable: true }.
// Anything unknown or out of range is left BLANK (and flagged), never filled
// with a plausible default: a pre-filled "twice a day" that is wrong looks
// exactly like one that is right, and tired reviewers trust what is there.
export function normalizeLabel(label, today) {
  if (!label || label.readable === false) return { unreadable: true };

  const values = {};
  const uncertain = new Set(
    (label.uncertain_fields || []).map((f) => FIELD_MAP[f]).filter(Boolean),
  );
  const flag = (field) => uncertain.add(field);
  const pick = (field, value, allowed) => {
    if (value in allowed) values[field] = value;
    else {
      values[field] = '';
      flag(field);
    }
  };

  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  values.nameEn = text(label.medicine_name);
  if (!values.nameEn) flag('nameEn');
  values.strength = text(label.strength);

  const dose = Number(label.dose_qty);
  if (label.dose_qty != null && dose > 0 && dose <= 20 && Number.isInteger(dose * 2)) values.doseQty = dose;
  else {
    values.doseQty = null;
    flag('doseQty');
  }

  pick('unit', label.unit, UNITS);
  pick('frequency', label.frequency, FREQUENCIES);
  pick('food', label.food, FOOD);

  if (needsRoute(values.unit)) {
    pick('route', label.route, ROUTES);
    if (ROUTES[values.route]?.sided) pick('side', label.side, SIDES);
    else values.side = '';
  } else {
    values.route = '';
    values.side = '';
  }

  if (values.frequency === 'PRN') {
    pick('prnReason', label.prn_reason, PRN_REASONS);
    const limit = (v, max) => {
      const n = Number(v);
      return v != null && Number.isInteger(n) && n > 0 && n <= max ? n : null;
    };
    values.maxPerDay = limit(label.max_per_day, 50);
    values.minHours = limit(label.min_hours, 48);
    flag('maxPerDay'); // a limit, or the lack of one, always deserves a look
    if (values.minHours != null) flag('minHours');
  } else {
    values.maxPerDay = null;
    values.minHours = null;
  }

  const warnings = Array.isArray(label.warnings) ? label.warnings : [];
  values.warnings = [...new Set(warnings.filter((w) => w in WARNINGS))];
  if (values.warnings.length !== warnings.length) flag('warnings');

  const qty = Number(label.quantity_supplied);
  if (label.quantity_supplied != null && qty > 0 && qty <= 1000) values.qtySupplied = qty;
  else values.qtySupplied = null;

  // The dispense date only drives refill timing, so a missing one defaults to
  // today. A future or very old date is almost certainly misread: flag it.
  if (isValidDate(label.dispensed_on) && label.dispensed_on <= today && label.dispensed_on >= addDays(today, -365)) {
    values.dispensedOn = label.dispensed_on;
  } else {
    values.dispensedOn = today;
    if (label.dispensed_on) flag('dispensedOn');
  }

  values.startDate = values.dispensedOn;
  const days = Number(label.duration_days);
  if (label.duration_days != null && Number.isInteger(days) && days > 0 && days <= 365) {
    values.endDate = addDays(values.startDate, days - 1);
  } else {
    values.endDate = '';
  }

  return {
    values,
    uncertain,
    instructionText: text(label.instruction_text),
    notes: text(label.notes),
  };
}

export function usingAiReader() {
  return Boolean(READ_LABEL_URL);
}

const ERRORS = {
  wrong_access_code: 'The access code is wrong. Check it under Routine → Label reading.',
  busy: 'The label reader is busy. Wait a moment and try again.',
  declined: 'This photo could not be read. Please type the details in.',
  'Image too large': 'The photo is too large. Try again with a smaller photo.',
};

// Free path: on-device OCR + rule-based parser. Returns the backend shape.
export async function readLabelOnDevice(file, progress) {
  const { text, confidence } = await recognizeLabel(file, progress);
  // Keep the raw text so the caregiver can see what was read (and why a
  // field might be blank).
  return { ...parseLabelText(text, confidence), ocr_text: text, ocr_confidence: Math.round(confidence) };
}

export async function readLabel(imageBase64, mediaType, accessCode) {
  let res;
  try {
    res = await fetch(READ_LABEL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-access-code': accessCode || '' },
      body: JSON.stringify({ image: imageBase64, mediaType }),
    });
  } catch {
    throw new Error('Could not reach the label reader. Check your internet connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(ERRORS[data.error] ?? 'The label could not be read. Please type the details in.');
  return data.label;
}
