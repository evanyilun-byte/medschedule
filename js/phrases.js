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

export const PRN_REASONS = {
  PRN_GENERIC: { en: 'Only when needed', zh: '需要的时候才吃' },
  PRN_PAIN: { en: 'Only when in pain', zh: '痛的时候才吃' },
  PRN_FEVER: { en: 'Only when there is fever', zh: '发烧的时候才吃' },
  PRN_BREATH: { en: 'Only when breathless', zh: '气喘的时候才用' },
  PRN_GIDDY: { en: 'Only when giddy', zh: '头晕的时候才吃' },
};

export const WARNINGS = {
  WARN_DROWSY: { en: 'May cause drowsiness', zh: '会让人想睡觉', icon: '😴' },
  WARN_COMPLETE: { en: 'Finish the whole course', zh: '要吃完全部', icon: '✅' },
  WARN_NO_ALCOHOL: { en: 'Do not drink alcohol', zh: '不要喝酒', icon: '🚫' },
  WARN_WATER: { en: 'Drink plenty of water', zh: '要多喝水', icon: '💧' },
  WARN_SWALLOW: { en: 'Swallow whole, do not chew', zh: '整粒吞，不要咬', icon: '💊' },
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
