import {
  SLOTS, SLOT_ORDER, FREQUENCIES, FOOD, UNITS, PRN_REASONS, WARNINGS, MISC,
  zhQuantity, enQuantity, timingPhrase, zhNumber,
} from './phrases.js';
import { buildSchedule, currentSlot, isActive } from './scheduler.js';
import { refillInfo, refillIcs } from './refill.js';
import { load, save, blankMedicine, sampleState, emptyState, nextNumber } from './storage.js';
import { normalizeLabel, usingAiReader, readLabel, readLabelOnDevice } from './extract.js';

let state = load();
const app = document.getElementById('app');

// ---------- helpers ----------

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function fmtDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return {
    en: d.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' }),
    zh: `${d.getMonth() + 1}月${d.getDate()}日`,
  };
}

const ZH_WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function to12h(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

function persist() {
  if (!save(state)) alert('Could not save — browser storage may be full or disabled. Try smaller photos.');
}

function medName(med) {
  return { zh: med.nicknameZh || med.nameEn, en: `${med.nameEn}${med.strength ? ` ${med.strength}` : ''}` };
}

function photoHtml(med, cls = 'pill-photo') {
  return med.photo
    ? `<img class="${cls}" src="${med.photo}" alt="Photo of ${esc(med.nameEn)}">`
    : `<div class="${cls} pill-placeholder" aria-hidden="true">💊</div>`;
}

// Photo with the packet number on its corner — the elder matches this
// number to the one the caregiver wrote on the packet.
function medIcon(med, cls = 'pill-photo') {
  return `<div class="med-id">${photoHtml(med, cls)}<span class="num-badge" aria-label="Medicine number ${med.number}">${med.number}</span></div>`;
}

function warningsHtml(med) {
  return (med.warnings || [])
    .map((w) => WARNINGS[w] && `<span class="warn">${WARNINGS[w].icon} ${WARNINGS[w].zh} <small>${WARNINGS[w].en}</small></span>`)
    .filter(Boolean)
    .join('');
}

function refillLine(med) {
  const info = refillInfo(med, todayStr());
  if (!info) return '';
  const d = fmtDate(info.runOut);
  return `<div class="refill-line refill-${info.status}">${d.zh}${MISC.REFILL_BY.zh} · ${MISC.REFILL_BY.en} ${d.en}</div>`;
}

// ---------- speech (prototype: browser text-to-speech) ----------

function speakText(med, slot) {
  const t = slot ? timingPhrase(slot, med.food) : null;
  const parts = [];
  if (med.number) parts.push(`${zhNumber(med.number)}${MISC.NUMBER_SUFFIX.zh}`);
  if (t) parts.push(t.zh);
  else parts.push(PRN_REASONS[med.prnReason]?.zh ?? PRN_REASONS.PRN_GENERIC.zh);
  parts.push(`${MISC.TAKE.zh}${zhQuantity(med.doseQty, med.unit)}`);
  parts.push(med.nicknameZh || med.nameEn);
  for (const w of med.warnings || []) if (WARNINGS[w]) parts.push(WARNINGS[w].zh);
  return parts.join('，') + '。';
}

function speak(text) {
  if (!('speechSynthesis' in window)) {
    alert('Audio is not supported in this browser.');
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = 0.8;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.replace('_', '-').startsWith('zh-CN'));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

// ---------- shared nav ----------

function nav(active) {
  const link = (href, en, zh) =>
    `<a href="${href}" class="${active === href ? 'active' : ''}">${zh}<small>${en}</small></a>`;
  return `<header class="topbar no-print">
    <a class="brand" href="#/schedule">💊 MedSchedule <small>吃药时间表</small></a>
    <nav>
      ${link('#/schedule', 'Schedule', '时间表')}
      ${link('#/meds', 'Medicines', '药物')}
      ${link('#/routine', 'Routine', '作息')}
      ${link('#/elder', 'Elder view', '老人模式')}
    </nav>
  </header>`;
}

// ---------- schedule (caregiver + printout) ----------

function refillAlerts() {
  const today = todayStr();
  const due = state.medicines
    .map((med) => ({ med, info: refillInfo(med, today) }))
    .filter(({ info }) => info && info.status !== 'ok')
    .sort((a, b) => a.info.runOut.localeCompare(b.info.runOut));
  if (!due.length) return '';
  return `<section class="card refill-card no-print">
    <h2>🔔 Refill soon <span class="zh">药快吃完了</span></h2>
    <ul class="refill-list">
      ${due.map(({ med, info }) => `<li class="refill-${info.status}">
        <strong>No. ${med.number} ${esc(med.nameEn)}</strong> ${esc(med.nicknameZh)} —
        ${info.daysLeft <= 0 ? 'has run out' : `runs out ${fmtDate(info.runOut).en} (${info.daysLeft} day${info.daysLeft === 1 ? '' : 's'})`}
        <button class="link" data-ics="${med.id}">Add reminder to calendar</button>
      </li>`).join('')}
    </ul>
  </section>`;
}

function scheduleSheet() {
  const today = todayStr();
  const { slots, asNeeded } = buildSchedule(state.medicines, state.person.routine, today);
  const name = state.person.name;
  const d = fmtDate(today);

  const row = (item) => {
    const { med, slot, time } = item;
    const t = timingPhrase(slot, med.food);
    const n = medName(med);
    return `<div class="dose-row">
      ${medIcon(med)}
      <div class="dose-time">${to12h(time)}</div>
      <div class="dose-main">
        <div class="dose-zh">${esc(t.zh)} · ${MISC.TAKE.zh}${esc(zhQuantity(med.doseQty, med.unit))} · ${esc(n.zh)}</div>
        <div class="dose-en">${esc(t.en)} · ${MISC.TAKE.en} ${esc(enQuantity(med.doseQty, med.unit))} · ${esc(n.en)}</div>
        ${warningsHtml(med)}
        ${refillLine(med)}
      </div>
      <div class="tickbox" aria-hidden="true"></div>
    </div>`;
  };

  const prnRow = (med) => {
    const reason = PRN_REASONS[med.prnReason] ?? PRN_REASONS.PRN_GENERIC;
    const n = medName(med);
    return `<div class="dose-row">
      ${medIcon(med)}
      <div class="dose-main">
        <div class="dose-zh">${esc(reason.zh)} · ${MISC.TAKE.zh}${esc(zhQuantity(med.doseQty, med.unit))} · ${esc(n.zh)}</div>
        <div class="dose-en">${esc(reason.en)} · ${MISC.TAKE.en} ${esc(enQuantity(med.doseQty, med.unit))} · ${esc(n.en)}</div>
        ${warningsHtml(med)}
      </div>
    </div>`;
  };

  return `<article class="sheet">
    <header class="sheet-head">
      <h1>${name ? `${esc(name)} 的` : ''}吃药时间表</h1>
      <p>${name ? `${esc(name)}'s ` : ''}Daily Medicine Schedule · ${d.zh} ${d.en}</p>
    </header>
    ${slots.map((s) => `<section class="slot slot-${s.slot}">
      <h2>${SLOTS[s.slot].icon} ${SLOTS[s.slot].zh} <small>${SLOTS[s.slot].en}</small></h2>
      ${s.items.map(row).join('')}
    </section>`).join('')}
    ${asNeeded.length ? `<section class="slot slot-prn">
      <h2>⚠️ 需要的时候才吃 <small>Only when needed</small></h2>
      ${asNeeded.map(prnRow).join('')}
    </section>` : ''}
    <footer class="sheet-foot">${MISC.ASK_PHARMACIST.zh} · This schedule is an aid only. ${MISC.ASK_PHARMACIST.en} if unsure.</footer>
  </article>`;
}

function viewSchedule() {
  const hasMeds = state.medicines.some((m) => isActive(m, todayStr()));
  return `${nav('#/schedule')}
  <main>
    ${refillAlerts()}
    ${hasMeds
      ? `<div class="toolbar no-print">
          <button class="primary" id="print">🖨️ Print schedule 打印</button>
          <a class="button" href="#/elder">👵 Open elder view 老人模式</a>
        </div>
        ${scheduleSheet()}`
      : `<section class="card empty">
          <h2>No medicines yet</h2>
          <p>Add each medicine from its label, or load an example to see how the schedule looks.</p>
          <div class="toolbar">
            <a class="button primary" href="#/meds/new">+ Add medicine</a>
            <button id="sample">Load example patient</button>
          </div>
        </section>`}
  </main>`;
}

// ---------- medicines ----------

function medSummary(med) {
  const f = FREQUENCIES[med.frequency];
  const food = med.frequency === 'PRN' ? '' : med.food === 'NONE' ? '' : ` · ${FOOD[med.food].en.toLowerCase()} food`;
  return `${enQuantity(med.doseQty, med.unit)} · ${f.en.toLowerCase()}${food}`;
}

function viewMeds() {
  const today = todayStr();
  const meds = [...state.medicines].sort((a, b) => (a.status === 'stopped') - (b.status === 'stopped'));
  return `${nav('#/meds')}
  <main>
    <div class="toolbar">
      <a class="button primary" href="#/meds/new">+ Add medicine 加药</a>
    </div>
    ${meds.length === 0
      ? '<p class="muted">No medicines yet.</p>'
      : `<p class="number-hint">✏️ ${MISC.WRITE_NUMBER.en} <span class="zh">${MISC.WRITE_NUMBER.zh}</span></p>`}
    <ul class="med-list">
      ${meds.map((med) => {
        const info = refillInfo(med, today);
        const inactive = !isActive(med, today);
        return `<li class="card med-card ${inactive ? 'inactive' : ''}">
          ${medIcon(med)}
          <div class="med-info">
            <h3>${esc(med.nameEn)} ${esc(med.strength)} <span class="zh">${esc(med.nicknameZh)}</span></h3>
            <p>${esc(medSummary(med))}</p>
            ${inactive ? `<p class="muted">${med.status === 'stopped' ? 'Stopped' : med.endDate && today > med.endDate ? `Course ended ${esc(med.endDate)}` : `Starts ${esc(med.startDate)}`}</p>` : ''}
            ${info ? `<p class="refill-${info.status}">Supply: runs out ${fmtDate(info.runOut).en}${info.status !== 'ok' ? ` — refill now` : ''}</p>` : ''}
          </div>
          <div class="med-actions">
            <a class="button" href="#/meds/${med.id}">Edit</a>
            ${med.frequency !== 'PRN' && med.status !== 'stopped' ? `<button data-count="${med.id}">I counted…</button>` : ''}
            ${med.status === 'stopped'
              ? `<button data-restart="${med.id}">Restart</button><button class="danger" data-delete="${med.id}">Delete</button>`
              : `<button data-stop="${med.id}">Stop</button>`}
          </div>
        </li>`;
      }).join('')}
    </ul>
  </main>`;
}

function options(map, selected, label = (v) => `${v.en} · ${v.zh}`) {
  return Object.entries(map)
    .map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${esc(label(v, k))}</option>`)
    .join('');
}

function viewMedForm(id) {
  const existing = state.medicines.find((m) => m.id === id);
  const med = existing ?? blankMedicine(todayStr());
  return `${nav('#/meds')}
  <main>
    <form id="med-form" class="card form" data-id="${med.id}">
      <h2>${existing ? `Edit medicine No. ${existing.number}` : 'Add medicine'} <span class="zh">${existing ? '修改' : '加药'}</span></h2>
      ${!existing
        ? `<div class="scan-box">
            <label class="button primary scan-button">📷 Scan label 拍药单
              <input type="file" id="scan-input" accept="image/*" capture="environment" hidden></label>
            <p class="muted">Take a clear, flat, well-lit photo of the printed label. The details are filled in for you to check — or type them in below.${usingAiReader() ? '' : ' The photo stays on this phone.'}</p>
            <div id="scan-status" role="status" aria-live="polite"></div>
          </div>`
        : ''}
      <div id="scan-review" class="scan-review hidden"></div>

      <fieldset>
        <legend>Medicine</legend>
        <label>Name on label <input name="nameEn" required value="${esc(med.nameEn)}" placeholder="e.g. Metformin"></label>
        <label>Strength <input name="strength" value="${esc(med.strength)}" placeholder="e.g. 500mg"></label>
        <label>Chinese nickname (shown big, spoken aloud)
          <input name="nicknameZh" value="${esc(med.nicknameZh)}" placeholder="e.g. 降血糖药 / 白色小粒"></label>
        <label>Photo of pill or packet
          <input type="file" name="photo" accept="image/*" capture="environment"></label>
        <div class="photo-preview">${med.photo ? photoHtml(med) : ''}</div>
        ${med.photo ? '<label class="check"><input type="checkbox" name="removePhoto"> Remove photo</label>' : ''}
      </fieldset>

      <fieldset>
        <legend>How to take it</legend>
        <div class="row">
          <label>Amount each time <input name="doseQty" type="number" min="0.5" step="0.5" required value="${med.doseQty}"></label>
          <label>Unit <select name="unit">${options(UNITS, med.unit, (v, k) => `${v.en[1]} · ${v.zh}`)}</select></label>
        </div>
        <label>How often <select name="frequency">${options(FREQUENCIES, med.frequency)}</select></label>
        <label>Food <select name="food">${options(FOOD, med.food, (v, k) => k === 'NONE' ? 'Not specified / any time' : `${v.en} food · 饭${v.zh}`)}</select></label>
        <label class="prn-only">If only when needed — for what?
          <select name="prnReason">${options(PRN_REASONS, med.prnReason)}</select></label>
        <div class="warnings">
          <span>Warnings on label</span>
          ${Object.entries(WARNINGS).map(([k, w]) => `<label class="check"><input type="checkbox" name="warnings" value="${k}" ${med.warnings.includes(k) ? 'checked' : ''}> ${w.icon} ${w.en} · ${w.zh}</label>`).join('')}
        </div>
      </fieldset>

      <fieldset>
        <legend>Dates and supply (for refill reminders)</legend>
        <div class="row">
          <label>Start date <input type="date" name="startDate" value="${esc(med.startDate)}"></label>
          <label>End date (short courses only) <input type="date" name="endDate" value="${esc(med.endDate)}"></label>
        </div>
        <div class="row">
          <label>Quantity given <input type="number" name="qtySupplied" min="0" step="0.5" value="${med.qtySupplied ?? ''}" placeholder="e.g. 60"></label>
          <label>Date dispensed <input type="date" name="dispensedOn" value="${esc(med.dispensedOn)}"></label>
        </div>
        <label>Remind me this many days before it runs out
          <input type="number" name="refillLeadDays" min="0" max="60" value="${med.refillLeadDays ?? 7}"></label>
      </fieldset>

      <label class="check review-confirm hidden">
        <input type="checkbox" name="reviewed"> I have checked every detail against the label 我已核对
      </label>
      <div class="toolbar">
        <button class="primary" type="submit">Save</button>
        <a class="button" href="#/meds">Cancel</a>
      </div>
    </form>
  </main>`;
}

// ---------- label scanning ----------

const FIELD_LABELS = {
  nameEn: 'name', strength: 'strength', doseQty: 'amount', unit: 'unit', frequency: 'how often',
  food: 'food', prnReason: 'when needed', warnings: 'warnings', qtySupplied: 'quantity',
  dispensedOn: 'date dispensed', endDate: 'end date',
};

function fieldWrapper(form, name) {
  const el = form.elements[name];
  const input = el instanceof RadioNodeList ? el[0] : el;
  return name === 'warnings' ? form.querySelector('.warnings') : input?.closest('label');
}

function fillForm(form, values, uncertain) {
  for (const [name, value] of Object.entries(values)) {
    if (name === 'warnings') {
      for (const box of form.querySelectorAll('input[name=warnings]')) box.checked = value.includes(box.value);
    } else if (form.elements[name]) {
      form.elements[name].value = value ?? '';
    }
  }
  form.elements.frequency.dispatchEvent(new Event('change'));
  for (const el of form.querySelectorAll('.needs-check')) el.classList.remove('needs-check');
  for (const name of uncertain) fieldWrapper(form, name)?.classList.add('needs-check');
}

async function scanLabel(form, file) {
  const status = document.getElementById('scan-status');
  const review = document.getElementById('scan-review');
  status.className = 'scan-busy';
  status.textContent = usingAiReader()
    ? 'Reading the label… 正在读取'
    : 'Getting the label reader ready (first time can take a minute)… 正在准备';
  try {
    const dataUrl = await resizeImage(file, 1568, 0.85);
    const label = usingAiReader()
      ? await readLabel(dataUrl.split(',')[1], 'image/jpeg', state.settings?.accessCode)
      : await readLabelOnDevice(file, (pct) => { status.textContent = `Reading the label… ${pct}% 正在读取`; });
    const result = normalizeLabel(label, todayStr());
    if (result.unreadable) {
      status.className = 'scan-error';
      status.textContent = 'This does not look like a readable medicine label. Try a clearer photo, or type the details in.';
      return;
    }
    fillForm(form, result.values, result.uncertain);
    if (!form.dataset.photo) form.dataset.photo = await resizeImage(file);
    const flagged = [...result.uncertain].map((f) => FIELD_LABELS[f]).filter(Boolean);
    review.innerHTML = `
      <img src="${dataUrl}" alt="Scanned label" class="label-photo">
      <div>
        <h3>Check before saving <span class="zh">请核对</span></h3>
        ${result.instructionText ? `<p>Label says: <q>${esc(result.instructionText)}</q></p>` : ''}
        ${flagged.length ? `<p class="refill-soon">⚠️ Please check closely: <strong>${esc(flagged.join(', '))}</strong></p>` : ''}
        ${result.notes ? `<p class="muted">Note: ${esc(result.notes)}</p>` : ''}
      </div>`;
    review.classList.remove('hidden');
    const confirmBox = form.querySelector('.review-confirm');
    confirmBox.classList.remove('hidden');
    confirmBox.querySelector('input').required = true;
    status.className = 'scan-ok';
    status.textContent = '✓ Label read. Check each field against the photo.';
  } catch (err) {
    status.className = 'scan-error';
    status.textContent = err.message;
  }
}

function resizeImage(file, max = 320, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function submitMedForm(form) {
  const fd = new FormData(form);
  const id = form.dataset.id;
  const existing = state.medicines.find((m) => m.id === id);
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const med = {
    ...(existing ?? { ...blankMedicine(todayStr()), number: nextNumber(state.medicines) }),
    id,
    nameEn: fd.get('nameEn').trim(),
    strength: fd.get('strength').trim(),
    nicknameZh: fd.get('nicknameZh').trim(),
    doseQty: Number(fd.get('doseQty')),
    unit: fd.get('unit'),
    frequency: fd.get('frequency'),
    food: fd.get('food'),
    prnReason: fd.get('prnReason'),
    warnings: fd.getAll('warnings'),
    startDate: fd.get('startDate'),
    endDate: fd.get('endDate'),
    qtySupplied: num(fd.get('qtySupplied')),
    dispensedOn: fd.get('dispensedOn'),
    refillLeadDays: num(fd.get('refillLeadDays')) ?? 7,
  };
  // A new supply replaces any earlier manual count.
  if (existing && (existing.qtySupplied !== med.qtySupplied || existing.dispensedOn !== med.dispensedOn)) {
    med.qtyAdjusted = null;
    med.adjustedOn = '';
  }
  const file = fd.get('photo');
  if (file && file.size) med.photo = await resizeImage(file);
  else if (!med.photo && form.dataset.photo) med.photo = form.dataset.photo; // scanned label
  if (fd.get('removePhoto')) med.photo = '';

  state.medicines = existing
    ? state.medicines.map((m) => (m.id === id ? med : m))
    : [...state.medicines, med];
  persist();
  location.hash = '#/meds';
}

// ---------- routine ----------

function viewRoutine() {
  const r = state.person.routine;
  const field = (key, en, zh) =>
    `<label>${zh} ${en} <input type="time" name="${key}" required value="${esc(r[key])}"></label>`;
  return `${nav('#/routine')}
  <main>
    <form id="routine-form" class="card form">
      <h2>Daily routine <span class="zh">作息时间</span></h2>
      <p class="muted">Vague label wording like "twice daily, after food" is turned into clock times using these.</p>
      <label>Name on schedule (optional) <input name="name" value="${esc(state.person.name)}" placeholder="e.g. Ah Ma / 婆婆"></label>
      <div class="row">
        ${field('wake', 'Wake up', '起床')}
        ${field('breakfast', 'Breakfast', '早餐')}
      </div>
      <div class="row">
        ${field('lunch', 'Lunch', '午餐')}
        ${field('dinner', 'Dinner', '晚餐')}
      </div>
      ${field('bed', 'Bedtime', '睡觉')}
      ${usingAiReader() ? `<label>Label reading access code (if you were given one)
        <input name="accessCode" autocomplete="off" value="${esc(state.settings?.accessCode)}"></label>` : ''}
      <div class="toolbar">
        <button class="primary" type="submit">Save</button>
      </div>
      <hr>
      <p class="muted">Data is stored only in this browser.</p>
      <button type="button" class="danger" id="reset">Clear all data</button>
    </form>
  </main>`;
}

// ---------- elder view ----------

function viewElder(slotParam) {
  const today = todayStr();
  const { slots, asNeeded } = buildSchedule(state.medicines, state.person.routine, today);
  const present = slots.map((s) => s.slot);
  let slot = SLOT_ORDER.includes(slotParam) ? slotParam : currentSlot(state.person.routine, nowHHMM());
  if (!slotParam && !present.includes(slot)) slot = present.find((s) => SLOT_ORDER.indexOf(s) >= SLOT_ORDER.indexOf(slot)) ?? present[0];
  const current = slots.find((s) => s.slot === slot);
  const taken = state.taken[today] || {};
  const d = new Date();

  const refillDue = state.medicines.filter((m) => {
    const info = refillInfo(m, today);
    return info && info.status !== 'ok';
  });

  const card = (item) => {
    const key = `${item.med.id}:${item.slot}`;
    const done = !!taken[key];
    const t = timingPhrase(item.slot, item.med.food);
    return `<div class="elder-card ${done ? 'done' : ''}">
      ${medIcon(item.med, 'elder-photo')}
      <div class="elder-text">
        <div class="elder-name">${esc(medName(item.med).zh)}</div>
        <div class="elder-dose">${esc(t.zh)} ${MISC.TAKE.zh}${esc(zhQuantity(item.med.doseQty, item.med.unit))}</div>
        <div class="elder-en">${esc(t.en)} · ${esc(enQuantity(item.med.doseQty, item.med.unit))} · ${esc(medName(item.med).en)}</div>
        ${warningsHtml(item.med)}
      </div>
      <div class="elder-buttons">
        <button class="big listen" data-speak="${item.med.id}" data-slot="${item.slot}">🔊 听</button>
        <button class="big take" data-take="${key}">${done ? '✓ 吃了' : '我吃了'}</button>
      </div>
    </div>`;
  };

  return `<div class="elder">
    <header class="elder-top">
      <div class="elder-date">${d.getMonth() + 1}月${d.getDate()}日 ${ZH_WEEKDAYS[d.getDay()]}</div>
      <a class="elder-exit" href="#/schedule">Exit 退出</a>
    </header>
    ${refillDue.length ? `<button class="elder-refill" data-speak-text="${esc(MISC.REFILL_SOON.zh)}">
      🔔 ${MISC.REFILL_SOON.zh} 🔊
      <small>${refillDue.map((m) => `${m.number}${MISC.NUMBER_SUFFIX.zh} ${esc(medName(m).zh)}`).join('、')} · ${MISC.REFILL_SOON.en}</small>
    </button>` : ''}
    <nav class="elder-slots">
      ${slots.map((s) => {
        const all = s.items.every((i) => taken[`${i.med.id}:${i.slot}`]);
        return `<a href="#/elder/${s.slot}" class="${s.slot === slot && slotParam !== 'prn' ? 'active' : ''}">${SLOTS[s.slot].icon}<br>${SLOTS[s.slot].zh}${all ? ' ✓' : ''}</a>`;
      }).join('')}
      ${asNeeded.length ? `<a href="#/elder/prn" class="${slotParam === 'prn' ? 'active' : ''}">⚠️<br>需要时</a>` : ''}
    </nav>
    <main class="elder-main">
      ${slotParam === 'prn'
        ? asNeeded.map((med) => `<div class="elder-card">
            ${medIcon(med, 'elder-photo')}
            <div class="elder-text">
              <div class="elder-name">${esc(medName(med).zh)}</div>
              <div class="elder-dose">${esc((PRN_REASONS[med.prnReason] ?? PRN_REASONS.PRN_GENERIC).zh)}</div>
              <div class="elder-en">${esc((PRN_REASONS[med.prnReason] ?? PRN_REASONS.PRN_GENERIC).en)} · ${esc(enQuantity(med.doseQty, med.unit))} · ${esc(medName(med).en)}</div>
            </div>
            <div class="elder-buttons"><button class="big listen" data-speak="${med.id}">🔊 听</button></div>
          </div>`).join('')
        : current
          ? current.items.map(card).join('')
          : '<p class="elder-empty">今天没有药 · No medicines today</p>'}
    </main>
  </div>`;
}

// ---------- router & events ----------

function render() {
  const [, route, param] = (location.hash || '#/schedule').split('/');
  document.body.classList.toggle('elder-mode', route === 'elder');
  if (route === 'meds' && param) app.innerHTML = viewMedForm(param === 'new' ? null : param);
  else if (route === 'meds') app.innerHTML = viewMeds();
  else if (route === 'routine') app.innerHTML = viewRoutine();
  else if (route === 'elder') app.innerHTML = viewElder(param);
  else app.innerHTML = viewSchedule();

  const freq = app.querySelector('select[name=frequency]');
  if (freq) {
    const sync = () => app.querySelector('.prn-only').classList.toggle('hidden', freq.value !== 'PRN');
    freq.addEventListener('change', sync);
    sync();
  }

  const form = app.querySelector('#med-form');
  if (form) {
    app.querySelector('#scan-input')?.addEventListener('change', (e) => {
      if (e.target.files[0]) scanLabel(form, e.target.files[0]);
      e.target.value = '';
    });
    // Editing a flagged field counts as checking it.
    form.addEventListener('input', (e) => e.target.closest('.needs-check')?.classList.remove('needs-check'));
  }
  window.scrollTo(0, 0);
}

function downloadIcs(med) {
  const info = refillInfo(med, todayStr());
  if (!info) return;
  const blob = new Blob([refillIcs(med, info)], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `refill-${med.nameEn.toLowerCase().replace(/\W+/g, '-')}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}

app.addEventListener('click', (e) => {
  const el = e.target.closest('button');
  if (!el) return;
  const findMed = (id) => state.medicines.find((m) => m.id === id);
  const d = el.dataset;

  if (el.id === 'print') window.print();
  else if (el.id === 'sample') {
    state = { ...sampleState(todayStr()), settings: state.settings };
    persist();
    render();
  } else if (el.id === 'reset') {
    if (confirm('Delete all medicines and settings stored in this browser?')) {
      state = emptyState();
      persist();
      location.hash = '#/schedule';
      render();
    }
  } else if (d.ics) downloadIcs(findMed(d.ics));
  else if (d.speak) speak(speakText(findMed(d.speak), d.slot));
  else if (d.speakText) speak(d.speakText);
  else if (d.take) {
    const today = todayStr();
    const day = (state.taken = { [today]: state.taken[today] || {} })[today]; // keep only today
    day[d.take] = !day[d.take];
    persist();
    render();
  } else if (d.count) {
    const med = findMed(d.count);
    const n = prompt(`How many ${UNITS[med.unit].en[1]} of ${med.nameEn} are left?`);
    if (n === null || n.trim() === '' || Number.isNaN(Number(n))) return;
    Object.assign(med, { qtyAdjusted: Number(n), adjustedOn: todayStr() });
    persist();
    render();
  } else if (d.stop) {
    findMed(d.stop).status = 'stopped';
    persist();
    render();
  } else if (d.restart) {
    findMed(d.restart).status = 'confirmed';
    persist();
    render();
  } else if (d.delete) {
    if (confirm('Delete this medicine permanently?')) {
      state.medicines = state.medicines.filter((m) => m.id !== d.delete);
      persist();
      render();
    }
  }
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'med-form') submitMedForm(e.target);
  else if (e.target.id === 'routine-form') {
    const fd = new FormData(e.target);
    state.person.name = fd.get('name').trim();
    for (const k of ['wake', 'breakfast', 'lunch', 'dinner', 'bed']) state.person.routine[k] = fd.get(k);
    if (fd.has('accessCode')) state.settings = { ...state.settings, accessCode: fd.get('accessCode').trim() };
    persist();
    location.hash = '#/schedule';
  }
});

window.addEventListener('hashchange', render);
if ('speechSynthesis' in window) speechSynthesis.getVoices(); // warm up voice list
render();
