// Label reading: read a photo (free on-device OCR by default, or the optional
// AI backend), then turn the answer into medicine form values. Anything
// unknown, missing or odd is flagged for the caregiver instead of trusted.
import { FREQUENCIES, FOOD, UNITS, PRN_REASONS, WARNINGS } from './phrases.js';
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
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s) {
  return typeof s === 'string' && ISO_DATE.test(s) && !Number.isNaN(Date.parse(s));
}

// Returns { values, uncertain, instructionText, notes } or { unreadable: true }.
export function normalizeLabel(label, today) {
  if (!label || label.readable === false) return { unreadable: true };

  const values = {};
  const uncertain = new Set(
    (label.uncertain_fields || []).map((f) => FIELD_MAP[f]).filter(Boolean),
  );
  const flag = (field) => uncertain.add(field);

  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  values.nameEn = text(label.medicine_name);
  if (!values.nameEn) flag('nameEn');
  values.strength = text(label.strength);

  const dose = Number(label.dose_qty);
  if (dose > 0 && dose <= 20 && Number.isInteger(dose * 2)) values.doseQty = dose;
  else {
    values.doseQty = 1;
    flag('doseQty');
  }

  if (label.unit in UNITS) values.unit = label.unit;
  else {
    values.unit = 'tablet';
    flag('unit');
  }

  if (label.frequency in FREQUENCIES) values.frequency = label.frequency;
  else {
    values.frequency = 'BD';
    flag('frequency');
  }

  if (label.food in FOOD) values.food = label.food;
  else {
    values.food = 'NONE';
    flag('food');
  }

  if (values.frequency === 'PRN') {
    if (label.prn_reason in PRN_REASONS) values.prnReason = label.prn_reason;
    else {
      values.prnReason = 'PRN_GENERIC';
      flag('prnReason');
    }
  }

  const warnings = Array.isArray(label.warnings) ? label.warnings : [];
  values.warnings = [...new Set(warnings.filter((w) => w in WARNINGS))];
  if (values.warnings.length !== warnings.length) flag('warnings');

  const qty = Number(label.quantity_supplied);
  if (label.quantity_supplied != null && qty > 0 && qty <= 1000) values.qtySupplied = qty;
  else values.qtySupplied = null;

  // A dispense date in the future or far past is almost certainly misread.
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
  return parseLabelText(text, confidence);
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
