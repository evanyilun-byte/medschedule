// Fixed, reviewable phrase library. The app never machine-translates:
// every Chinese string shown or spoken comes from this file.

export const SLOTS = {
  morning: { en: 'Morning', zh: '早上', icon: '☀️', meal: 'breakfast' },
  noon: { en: 'Noon', zh: '中午', icon: '🌤️', meal: 'lunch' },
  evening: { en: 'Evening', zh: '晚上', icon: '🌇', meal: 'dinner' },
  bedtime: { en: 'Bedtime', zh: '睡前', icon: '🌙', meal: null },
};

export const SLOT_ORDER = ['morning', 'noon', 'evening', 'bedtime'];

export const MEALS = {
  breakfast: { en: 'breakfast', zh: '早餐' },
  lunch: { en: 'lunch', zh: '午餐' },
  dinner: { en: 'dinner', zh: '晚餐' },
};

// slots: which parts of the day the medicine is taken in.
export const FREQUENCIES = {
  OM: { en: 'Once a day, in the morning', zh: '每天一次，早上', slots: ['morning'] },
  OD: { en: 'Once a day', zh: '每天一次', slots: ['morning'] },
  BD: { en: 'Twice a day', zh: '每天两次', slots: ['morning', 'evening'] },
  TDS: { en: 'Three times a day', zh: '每天三次', slots: ['morning', 'noon', 'evening'] },
  QDS: { en: 'Four times a day', zh: '每天四次', slots: ['morning', 'noon', 'evening', 'bedtime'] },
  ON: { en: 'Once a day, at night', zh: '每天一次，晚上', slots: ['bedtime'] },
  PRN: { en: 'Only when needed', zh: '需要的时候才吃', slots: [] },
};

// offset: minutes relative to the meal time.
export const FOOD = {
  AFTER: { en: 'After', zh: '后', offset: 30 },
  BEFORE: { en: 'Before', zh: '前', offset: -30 },
  WITH: { en: 'With', zh: '时', offset: 0 },
  NONE: { en: 'Any time', zh: '', offset: 0 },
};

export const UNITS = {
  tablet: { en: ['tablet', 'tablets'], zh: '粒' },
  capsule: { en: ['capsule', 'capsules'], zh: '粒' },
  ml: { en: ['ml', 'ml'], zh: '毫升' },
  sachet: { en: ['sachet', 'sachets'], zh: '包' },
  puff: { en: ['puff', 'puffs'], zh: '喷' },
  drop: { en: ['drop', 'drops'], zh: '滴' },
};

// Where drops and puffs go. Eye and ear also take a side.
export const ROUTES = {
  eye: { en: 'Eye', zh: '眼睛', sided: true, for: 'drop' },
  ear: { en: 'Ear', zh: '耳朵', sided: true, for: 'drop' },
  nose: { en: 'Nose', zh: '鼻子', sided: false, for: 'both' },
  mouth: { en: 'Mouth (inhaler)', zh: '嘴（吸入）', sided: false, for: 'puff' },
};

export const SIDES = {
  both: { en: 'Both', zh: '两边' },
  left: { en: 'Left', zh: '左边' },
  right: { en: 'Right', zh: '右边' },
};

const ORGAN = { eye: { zh: '眼', en: 'eye' }, ear: { zh: '耳', en: 'ear' } };

export function needsRoute(unit) {
  return unit === 'drop' || unit === 'puff';
}

// The action said and shown for one dose. The verb depends on the unit and,
// for drops and puffs, on where the medicine goes — "吃一滴" (eat one drop)
// for an eye drop would be wrong and unsafe. `complete` is false when a
// drop or puff has no route yet, so the form can insist on one.
export function doseAction(med) {
  const qZh = zhQuantity(med.doseQty, med.unit);
  const qEn = enQuantity(med.doseQty, med.unit);
  switch (med.unit) {
    case 'ml':
      return { zh: `喝${qZh}`, en: `Drink ${qEn}`, complete: true };
    case 'sachet':
      return { zh: `服${qZh}`, en: `Take ${qEn}`, complete: true };
    case 'drop': {
      const o = ORGAN[med.route];
      if (o && med.side === 'both') return { zh: `每只${o.zh}滴${qZh}`, en: `${qEn} in each ${o.en}`, complete: true };
      if (o && (med.side === 'left' || med.side === 'right')) {
        return { zh: `${med.side === 'left' ? '左' : '右'}${o.zh}滴${qZh}`, en: `${qEn} in the ${med.side} ${o.en}`, complete: true };
      }
      if (med.route === 'nose') return { zh: `鼻子滴${qZh}`, en: `${qEn} in the nose`, complete: true };
      return { zh: `滴${qZh}`, en: qEn, complete: false };
    }
    case 'puff':
      if (med.route === 'mouth') return { zh: `吸${qZh}`, en: `Inhale ${qEn}`, complete: true };
      if (med.route === 'nose') return { zh: `鼻子喷${qZh}`, en: `${qEn} in the nose`, complete: true };
      return { zh: `用${qZh}`, en: `Use ${qEn}`, complete: false };
    default: // tablet, capsule
      return { zh: `吃${qZh}`, en: `Take ${qEn}`, complete: true };
  }
}

// The title the elder sees: always the packet number ("3号药"), the same on
// every card and on the packet. A nickname, if any, is shown under it; the
// English drug name, which they can't read, is never the title.
export function zhName(med) {
  if (med.number) return `${med.number}${MISC.NUMBER_SUFFIX.zh}`;
  return med.nicknameZh || med.nameEn; // not saved yet, so no number
}

// Words on the elder's tick button, matching the verb above.
export function takenWords(unit) {
  if (unit === 'ml') return { ask: '我喝了', done: '✓ 喝了' };
  if (unit === 'drop' || unit === 'puff') return { ask: '我用了', done: '✓ 用了' };
  return { ask: '我吃了', done: '✓ 吃了' };
}

// Limits for "only when needed" medicines, only ever as printed on the label
// or entered by the caregiver — the app never suggests a number.
export function limitPhrase(med) {
  const zh = [];
  const en = [];
  if (med.maxPerDay) {
    zh.push(`一天最多${zhQuantity(med.maxPerDay, med.unit)}`);
    en.push(`Max ${enQuantity(med.maxPerDay, med.unit)} a day`);
  }
  if (med.minHours) {
    zh.push(`每次隔${zhNumber(med.minHours)}小时`);
    en.push(`At least ${med.minHours} hours apart`);
  }
  return zh.length ? { zh: zh.join('，'), en: en.join(' · ') } : null;
}

export const PRN_REASONS = {
  PRN_GENERIC: { en: 'Only when needed', zh: '需要的时候才吃' },
  PRN_PAIN: { en: 'Only when in pain', zh: '痛的时候才吃' },
  PRN_FEVER: { en: 'Only when there is fever', zh: '发烧的时候才吃' },
  PRN_BREATH: { en: 'Only when breathless', zh: '气喘的时候才用' },
  PRN_GIDDY: { en: 'Only when giddy', zh: '头晕的时候才吃' },
};

// short: compact chip text for the schedule and elder view; the full
// wording is spoken aloud and shown in the medicine list.
export const WARNINGS = {
  WARN_DROWSY: { en: 'May cause drowsiness', zh: '会让人想睡觉', short: '想睡', icon: '😴' },
  WARN_COMPLETE: { en: 'Finish the whole course', zh: '要吃完全部', short: '吃完', icon: '✅' },
  WARN_NO_ALCOHOL: { en: 'Do not drink alcohol', zh: '不要喝酒', short: '不喝酒', icon: '🚫' },
  WARN_WATER: { en: 'Drink plenty of water', zh: '要多喝水', short: '多喝水', icon: '💧' },
  WARN_SWALLOW: { en: 'Swallow whole, do not chew', zh: '整粒吞，不要咬', short: '整粒吞', icon: '💊' },
};

export const MISC = {
  REFILL_SOON: { en: 'Running out soon — get more', zh: '药快吃完了，要去拿药' },
  REFILL_BY: { en: 'Refill by', zh: '前拿药' },
  ASK_PHARMACIST: { en: 'Check with your pharmacist', zh: '请问药剂师' },
  TAKE: { en: 'Take', zh: '吃' },
  NUMBER_SUFFIX: { en: 'No.', zh: '号药' },
  WRITE_NUMBER: {
    en: "Write each medicine's number on its packet with a marker, so it matches the schedule.",
    zh: '用笔把号码写在药袋上',
  },
};

// 1 → 一, 10 → 十, 12 → 十二, 25 → 二十五 (for "三号药").
export function zhNumber(n) {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return digits[n];
  if (n < 20) return `十${n % 10 ? digits[n % 10] : ''}`;
  if (n < 100) return `${digits[Math.floor(n / 10)]}十${n % 10 ? digits[n % 10] : ''}`;
  return String(n);
}

const ZH_DIGITS = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];

// Chinese quantity words: 0.5 → 半, 1 → 一, 2 → 两, 1.5 → 一…半.
export function zhQuantity(qty, unit) {
  const unitZh = UNITS[unit]?.zh ?? '';
  const whole = Math.floor(qty);
  const half = qty - whole === 0.5;
  if (whole === 0 && half) return `半${unitZh}`;
  const num = whole <= 10 ? ZH_DIGITS[whole] : String(whole);
  return `${num}${unitZh}${half ? '半' : ''}`;
}

export function enQuantity(qty, unit) {
  const [one, many] = UNITS[unit]?.en ?? [unit, unit];
  const num = qty === 0.5 ? '½' : String(qty).replace('.5', '½');
  return `${num} ${qty <= 1 ? one : many}`;
}

// "After breakfast" / "早餐后"; bedtime and NONE have no meal wording.
export function timingPhrase(slot, foodCode) {
  const meal = SLOTS[slot].meal;
  if (!meal || foodCode === 'NONE') return { en: SLOTS[slot].en, zh: SLOTS[slot].zh };
  const food = FOOD[foodCode];
  return {
    en: `${food.en} ${MEALS[meal].en}`,
    zh: `${MEALS[meal].zh}${food.zh}`,
  };
}
