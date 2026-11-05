// Rule-based reader for Singapore medicine label text (from on-device OCR).
// Returns the same shape as the optional AI backend, so normalizeLabel()
// checks both the same way. Pure and deterministic: same text, same result.

const WORD_NUMBERS = { HALF: 0.5, ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, '½': 0.5, '1/2': 0.5 };
const NUM = String.raw`(\d+(?:\.\d+)?|½|1\/2|HALF|ONE|TWO|THREE|FOUR|FIVE|SIX)`;
const UNIT_WORDS = {
  tablet: 'TAB(?:LET)?S?(?:\\(S\\))?',
  capsule: 'CAP(?:SULE)?S?(?:\\(S\\))?',
  ml: 'ML',
  sachet: 'SACHETS?(?:\\(S\\))?',
  puff: 'PUFFS?(?:\\(S\\))?',
  drop: 'DROPS?(?:\\(S\\))?',
};
const UNIT_RE = Object.values(UNIT_WORDS).join('|');
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const STRENGTH_RE = /(\d+(?:\.\d+)?)\s?(MCG|MG|ML|G|%|IU)(?![A-Z])/;
// Lines that are clinic/patient details rather than the drug name.
const NOT_NAME = /\b(TAKE|QTY|QUANTITY|DATE|PATIENT|NAME|CLINIC|POLYCLINIC|HOSPITAL|PHARMACY|TEL|NRIC|DR|DOCTOR|KEEP|EXP|REG|SINGAPORE)\b/;

const toNumber = (s) => WORD_NUMBERS[s] ?? Number(s);

// OCR commonly reads O as 0 and I/l as 1 inside numbers; fix just those.
export function cleanText(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[‘’`]/g, "'")
    .replace(/(\d)[O](?=\d|\s*(?:MG|TAB|CAP))/g, '$10')
    .replace(/\b[IL](?=\s*(?:TAB|CAP|TIME|DROP|PUFF))/g, '1')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

function unitFrom(word) {
  return Object.entries(UNIT_WORDS).find(([, re]) => new RegExp(`^(?:${re})$`).test(word))?.[0] ?? null;
}

function findName(lines) {
  for (const line of lines) {
    if (NOT_NAME.test(line)) continue;
    const m = line.match(STRENGTH_RE);
    if (!m) continue;
    const before = line.slice(0, m.index).replace(/[^A-Z\s-]/g, ' ').trim();
    const words = before.split(/\s+/).filter((w) => w.length >= 3);
    if (words.length) {
      const name = words.join(' ').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
      return { name, strength: `${m[1]}${m[2].toLowerCase()}` };
    }
  }
  return { name: null, strength: null };
}

function findDose(text) {
  const m = text.match(new RegExp(`\\b(?:TAKE|USE|INHALE|APPLY|GIVE|INSTIL+|PUT|SPRAY)\\s+${NUM}\\s*(${UNIT_RE})`));
  if (!m) return { dose: null, unit: null };
  return { dose: toNumber(m[1]), unit: unitFrom(m[2]) };
}

// Where drops and puffs go, and which side for eyes and ears.
function findRoute(text, unit) {
  const side = (organ) => {
    if (new RegExp(`\\b(?:BOTH|EACH) ${organ}S?\\b|\\b${organ}S\\b`).test(text)) return 'both';
    if (new RegExp(`\\bLEFT ${organ}\\b`).test(text)) return 'left';
    if (new RegExp(`\\bRIGHT ${organ}\\b`).test(text)) return 'right';
    return null;
  };
  if (/\bEYES?\b/.test(text)) return { route: 'eye', side: side('EYE') };
  if (/\bEARS?\b/.test(text)) return { route: 'ear', side: side('EAR') };
  if (/\bNOS(?:E|TRILS?)\b|\bNASAL\b/.test(text)) return { route: 'nose', side: null };
  if (unit === 'puff' && /\bINHALE|\bINHALER\b|\bMOUTH\b/.test(text)) return { route: 'mouth', side: null };
  return { route: null, side: null };
}

// Limits for "when needed" medicines, exactly as printed.
function findMaxPerDay(text) {
  const m = text.match(new RegExp(`\\b(?:MAX(?:IMUM)?\\.?|NOT MORE THAN|NO MORE THAN|NOT TO EXCEED|DO NOT TAKE MORE THAN|DO NOT EXCEED)\\s*:?\\s*(\\d{1,2})\\s*(?:${UNIT_RE})?\\s*(?:IN|PER|A|EACH)\\s*(?:24\\s*HOURS?|DAY|ONE DAY)\\b`));
  return m ? Number(m[1]) : null;
}

function findMinHours(text) {
  const m = text.match(/\bAT LEAST\s*(\d{1,2})\s*(?:HOURS?|HRS?)\s*APART\b/)
    || text.match(/\bEVERY\s*(\d{1,2})\s*(?:-|TO)\s*\d{1,2}\s*(?:HOURS?|HRS?)\b/)
    || text.match(/\bEVERY\s*(\d{1,2})\s*(?:HOURS?|HRS?)\b/);
  return m ? Number(m[1]) : null;
}

function findFrequency(text) {
  const found = new Set();
  const times = text.match(/\b(\d|ONE|TWO|THREE|FOUR)\s*TIMES?(?:\(S\))?\s*(?:A|PER|EACH)\s*DAY\b/);
  if (times) found.add({ 1: 'OD', 2: 'BD', 3: 'TDS', 4: 'QDS' }[toNumber(times[1])]);
  if (/\bONCE\s+(?:A\s+)?DA(?:Y|ILY)\b|\bONCE\s+DAILY\b/.test(text)) found.add('OD');
  if (/\bTWICE\s+(?:A\s+)?DA(?:Y|ILY)\b/.test(text)) found.add('BD');
  if (/\bTHRICE\b/.test(text)) found.add('TDS');
  for (const [abbr, code] of [['OM', 'OM'], ['ON', 'ON'], ['OD', 'OD'], ['BD', 'BD'], ['BID', 'BD'], ['TDS', 'TDS'], ['TID', 'TDS'], ['QDS', 'QDS'], ['QID', 'QDS']]) {
    // "ON" is also an English word; only count it beside a dose or alone on a line.
    const re = abbr === 'ON' ? /(?:TAB|CAP|^)\S*\s+ON\b(?!\s+(?:THE|A|AN|EMPTY))/m : new RegExp(`\\b${abbr}\\b`);
    if (re.test(text)) found.add(code);
  }
  if (/\b(?:EVERY|IN THE|EACH)\s+MORNING\b/.test(text) && (found.has('OD') || found.size === 0)) {
    found.delete('OD');
    found.add('OM');
  }
  if (/\b(?:AT|EVERY|EACH)\s+NIGHT\b|\bAT BEDTIME\b|\bBEFORE (?:SLEEP|BED)\b/.test(text) && (found.has('OD') || found.size === 0)) {
    found.delete('OD');
    found.add('ON');
  }
  const prn = /\b(?:PRN|WHEN NECESSARY|WHEN REQUIRED|WHEN NEEDED|AS NEEDED|AS REQUIRED|IF NEEDED|IF REQUIRED|IF NECESSARY)\b/.test(text);
  if (prn) found.add('PRN');
  // PRN together with a frequency ("2 times a day when needed") is still PRN.
  if (prn) return { frequency: 'PRN', ambiguous: false };
  if (found.size === 1) return { frequency: [...found][0], ambiguous: false };
  return { frequency: null, ambiguous: found.size > 1 };
}

function findFood(text) {
  const after = /\bAFTER\s+(?:FOOD|MEALS?|BREAKFAST|LUNCH|DINNER|EATING)\b|\bPC\b/.test(text);
  const before = /\bBEFORE\s+(?:FOOD|MEALS?|BREAKFAST|LUNCH|DINNER|EATING)\b|\bAC\b|\bEMPTY STOMACH\b/.test(text);
  const withFood = /\bWITH\s+(?:FOOD|MEALS?)\b/.test(text);
  const hits = [after && 'AFTER', before && 'BEFORE', withFood && 'WITH'].filter(Boolean);
  return hits.length === 1 ? hits[0] : null;
}

function findPrnReason(text) {
  if (/\bPAIN\b|\bACHE\b/.test(text)) return 'PRN_PAIN';
  if (/\bFEVER\b/.test(text)) return 'PRN_FEVER';
  if (/\bBREATHLESS|\bSHORTNESS OF BREATH\b|\bWHEEZ/.test(text)) return 'PRN_BREATH';
  if (/\bGIDD|\bDIZZ/.test(text)) return 'PRN_GIDDY';
  return 'PRN_GENERIC';
}

function findWarnings(text) {
  const w = [];
  if (/\bDROWS|\bSLEEPY\b/.test(text)) w.push('WARN_DROWSY');
  if (/\bCOMPLETE (?:THE )?(?:WHOLE |FULL |ENTIRE )?COURSE\b|\bFINISH (?:THE )?(?:WHOLE |FULL |ENTIRE )?(?:COURSE|MEDICINE)\b/.test(text)) w.push('WARN_COMPLETE');
  if (/\bALCOHOL\b/.test(text)) w.push('WARN_NO_ALCOHOL');
  if (/\bPLENTY OF (?:WATER|FLUIDS?)\b/.test(text)) w.push('WARN_WATER');
  if (/\bSWALLOW (?:IT )?WHOLE\b|\bDO NOT (?:CHEW|CRUSH)\b/.test(text)) w.push('WARN_SWALLOW');
  return w;
}

function findQuantity(lines) {
  for (const line of lines) {
    const m = line.match(new RegExp(`\\bQ(?:TY|UANTITY)\\.?\\s*:?\\s*(\\d+)\\s*(?:${UNIT_RE})?`));
    if (m) return Number(m[1]);
  }
  // No "QTY": take the largest "N TABS" outside the dosing lines, since a
  // shorthand dose line like "1 TAB OM" also has a number and a unit.
  const DOSING = /\b(TAKE|USE|INHALE|APPLY|GIVE|INSTIL+|PUT|SPRAY|OM|ON|OD|BD|BID|TDS|TID|QDS|QID|PRN|DAILY|TIMES?|NIGHT|MORNING|MAX(?:IMUM)?|EXCEED|EVERY)\b/;
  let best = null;
  for (const line of lines) {
    if (DOSING.test(line)) continue;
    for (const m of line.matchAll(new RegExp(`\\b(\\d{1,3})\\s*(?:${UNIT_RE})\\b`, 'g'))) {
      best = Math.max(best ?? 0, Number(m[1]));
    }
  }
  return best;
}

const pad = (n) => String(n).padStart(2, '0');

// Singapore labels put the day first: 05/11/2026, 5-11-26, 05 NOV 2026.
function findDate(text) {
  let m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (m) {
    const [d, mo] = [Number(m[1]), Number(m[2])];
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  m = text.match(/\b(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*(\d{4})\b/);
  if (m) return `${m[3]}-${pad(MONTHS[m[2]])}-${pad(Number(m[1]))}`;
  return null;
}

function findDuration(text) {
  const m = text.match(/\bFOR\s+(\d{1,3})\s*DAYS?\b/) || text.match(/\bX\s*(\d{1,2})\s*\/\s*7\b/);
  return m ? Number(m[1]) : null;
}

export function parseLabelText(rawText, ocrConfidence = 100) {
  const text = cleanText(rawText);
  const lines = text.split('\n');
  const { name, strength } = findName(lines);
  const { dose, unit } = findDose(text);
  const { frequency, ambiguous } = findFrequency(text);
  const food = findFood(text);

  if (!name && dose == null && !frequency) {
    return { readable: false };
  }

  const uncertain = [];
  if (!name) uncertain.push('medicine_name');
  if (dose == null) uncertain.push('dose_qty');
  if (!unit) uncertain.push('unit');
  if (!frequency || ambiguous) uncertain.push('frequency');
  // Food wording matters for scheduled tablets; for "when needed" medicines,
  // drops and puffs a silent label simply means "not stated".
  const foodOptional = frequency === 'PRN' || unit === 'drop' || unit === 'puff';
  if (!food && !foodOptional) uncertain.push('food');
  const { route, side } = unit === 'drop' || unit === 'puff' ? findRoute(text, unit) : { route: null, side: null };
  if ((unit === 'drop' || unit === 'puff') && !route) uncertain.push('route');
  if ((route === 'eye' || route === 'ear') && !side) uncertain.push('side');
  const maxPerDay = findMaxPerDay(text);
  const minHours = findMinHours(text);
  // Limits are always worth a second look; a "when needed" medicine without one is flagged too.
  if (maxPerDay != null || frequency === 'PRN') uncertain.push('max_per_day');
  if (minHours != null) uncertain.push('min_hours');
  // A blurry photo makes every reading suspect.
  if (ocrConfidence < 70) {
    for (const f of ['medicine_name', 'strength', 'dose_qty', 'frequency', 'food', 'quantity_supplied']) {
      if (!uncertain.includes(f)) uncertain.push(f);
    }
  }

  // The dosing line, plus a continuation line such as "AFTER FOOD".
  const instructionLines = [];
  lines.forEach((l, i) => {
    if (!/\b(TAKE|USE|INHALE|APPLY|GIVE|INSTIL+|PUT|SPRAY)\b/.test(l)) return;
    instructionLines.push(l);
    const next = lines[i + 1];
    if (next && /^(AFTER|BEFORE|WITH|ON|AT|IN|EVERY|FOR|WHEN|IF|AS|TO|MAX|NOT|DO NOT)\b/.test(next)) instructionLines.push(next);
  });

  return {
    readable: true,
    medicine_name: name,
    strength,
    dose_qty: dose,
    unit,
    frequency,
    food: food ?? (foodOptional ? 'NONE' : null),
    route,
    side,
    max_per_day: maxPerDay,
    min_hours: minHours,
    prn_reason: frequency === 'PRN' ? findPrnReason(text) : null,
    warnings: findWarnings(text),
    quantity_supplied: findQuantity(lines),
    dispensed_on: findDate(text),
    duration_days: findDuration(text),
    uncertain_fields: uncertain,
    instruction_text: instructionLines.join(' ').slice(0, 200),
    notes: ocrConfidence < 70 ? 'The photo was hard to read — check every field.' : null,
  };
}
