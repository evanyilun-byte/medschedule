import {
  SLOTS, SLOT_ORDER, FREQUENCIES, FOOD, UNITS, PRN_REASONS, WARNINGS, MISC,
  zhQuantity, enQuantity, timingPhrase, zhNumber, ROUTES, SIDES, needsRoute, doseAction, limitPhrase, takenWords, zhName,
} from './phrases.js';
import { buildSchedule, isActive, groupByTime, elderNow, groupStatus } from './scheduler.js';
import { refillInfo, refillIcs } from './refill.js';
import {
  load, save, blankMedicine, sampleMedicines, emptyState, takeNumber, syncLastNumber, newProfile, activeProfile, allMedicines,
} from './storage.js';
import { normalizeLabel, usingAiReader, readLabel, readLabelOnDevice } from './extract.js';

let state = load();
// The person being looked at, on the caregiver screens and in the elder view.
const P = () => activeProfile(state);
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
  return { zh: zhName(med), en: `${med.nameEn}${med.strength ? ` ${med.strength}` : ''}` };
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

// Compact chips by default; full wording only in the medicine list.
function warningsHtml(med, full = false) {
  return (med.warnings || [])
    .map((w) => {
      const x = WARNINGS[w];
      if (!x) return '';
      return full
        ? `<span class="warn">${x.icon} ${x.zh} <small>${x.en}</small></span>`
        : `<span class="warn" title="${x.en}">${x.icon} ${x.short}</span>`;
    })
    .join('');
}

// Group heading: meal wording when there is one ("早餐后"), else just the time.
function groupHeading(group) {
  const t = timingPhrase(group.slot, group.food);
  const withMeal = SLOTS[group.slot].meal && group.food !== 'NONE';
  return { zh: withMeal ? t.zh : '', en: withMeal ? t.en : '', time: to12h(group.time) };
}

// ---------- speech (prototype: browser text-to-speech) ----------

function speakText(med, slot) {
  const t = slot ? timingPhrase(slot, med.food) : null;
  const parts = [];
  if (med.number) parts.push(`${zhNumber(med.number)}${MISC.NUMBER_SUFFIX.zh}`);
  if (t) parts.push(t.zh);
  else parts.push(PRN_REASONS[med.prnReason]?.zh ?? PRN_REASONS.PRN_GENERIC.zh);
  parts.push(doseAction(med).zh);
  if (med.nicknameZh) parts.push(med.nicknameZh); // the number already opened the sentence
  if (!slot && limitPhrase(med)) parts.push(limitPhrase(med).zh);
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
  </header>
  <div class="profile-bar no-print" role="group" aria-label="Person being cared for">
    <span class="muted">Caring for 照顾:</span>
    ${state.profiles.map((p) => `<button class="profile-chip ${p.id === P().id ? 'active' : ''}" data-profile="${p.id}"
      aria-pressed="${p.id === P().id}">${esc(profileName(p))}</button>`).join('')}
    <button class="profile-chip add" id="add-profile">+ Add person 加人</button>
  </div>`;
}

function profileName(p) {
  return p.name || `Person ${state.profiles.indexOf(p) + 1}`;
}

// ---------- schedule (caregiver + printout) ----------

function refillAlerts() {
  const today = todayStr();
  const due = P().medicines
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
  const { slots, asNeeded } = buildSchedule(P().medicines, P().routine, today);
  const name = P().name;
  const d = fmtDate(today);

  // One row = number + photo, Chinese name + amount, a short English line.
  const row = (med, extra = '') => {
    const n = medName(med);
    return `<div class="dose-row">
      ${medIcon(med)}
      <div class="dose-main">
        <div class="dose-zh"><span class="dose-name">${esc(n.zh)}</span> <span class="dose-qty">${esc(doseAction(med).zh)}</span></div>
        ${extra}
        <div class="dose-en">${esc(n.en)} · ${esc(doseAction(med).en)}</div>
      </div>
      <div class="dose-warn">${warningsHtml(med)}</div>
      ${extra ? '' : '<div class="tickbox" aria-hidden="true"></div>'}
    </div>`;
  };

  const group = (g) => {
    const h = groupHeading(g);
    return `<div class="dose-group">
      <h3><span class="dose-group-time">${h.time}</span>${h.zh ? ` ${esc(h.zh)} <small>${esc(h.en)}</small>` : ''}</h3>
      ${g.items.map((i) => row(i.med)).join('')}
    </div>`;
  };

  const prnRow = (med) => {
    const reason = PRN_REASONS[med.prnReason] ?? PRN_REASONS.PRN_GENERIC;
    const limit = limitPhrase(med);
    return row(med, `<div class="dose-reason">${esc(reason.zh)} <small>${esc(reason.en)}</small></div>${limit ? `<div class="dose-limit">⚠️ ${esc(limit.zh)} <small>${esc(limit.en)}</small></div>` : ''}`);
  };

  return `<article class="sheet">
    <header class="sheet-head">
      <h1>${name ? `${esc(name)} 的` : ''}吃药时间表</h1>
      <p>${name ? `${esc(name)}'s ` : ''}Daily Medicine Schedule · ${d.zh} ${d.en}</p>
    </header>
    ${slots.map((s) => `<section class="slot slot-${s.slot}">
      <h2>${SLOTS[s.slot].icon} ${SLOTS[s.slot].zh} <small>${SLOTS[s.slot].en}</small></h2>
      ${groupByTime(s.items).map(group).join('')}
    </section>`).join('')}
    ${asNeeded.length ? `<section class="slot slot-prn">
      <h2>⚠️ 需要的时候才吃 <small>Only when needed</small></h2>
      ${asNeeded.map(prnRow).join('')}
    </section>` : ''}
    <footer class="sheet-foot">${MISC.ASK_PHARMACIST.zh} · This schedule is an aid only. ${MISC.ASK_PHARMACIST.en} if unsure.</footer>
  </article>`;
}

function viewSchedule() {
  const hasMeds = P().medicines.some((m) => isActive(m, todayStr()));
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
  const a = doseAction(med);
  const limit = med.frequency === 'PRN' ? limitPhrase(med) : null;
  return `${a.en} · ${f.en.toLowerCase()}${food}${limit ? ` · ${limit.en}` : ''}${a.complete ? '' : ' · ⚠️ choose where it goes'}`;
}

function viewMeds() {
  const today = todayStr();
  const meds = [...P().medicines].sort((a, b) => (a.status === 'stopped') - (b.status === 'stopped'));
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
            ${warningsHtml(med, true)}
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
    ${meds.length ? `<div class="toolbar danger-zone">
      <button class="danger" id="clear-meds">Remove all of ${esc(profileName(P()))}'s medicines 删除所有药物</button>
    </div>` : ''}
  </main>`;
}

// Every list starts on "choose": nothing is pre-picked for the caregiver.
function options(map, selected, label = (v) => `${v.en} · ${v.zh}`) {
  return `<option value="" ${selected ? '' : 'selected'} disabled>— choose 请选择 —</option>`
    + Object.entries(map)
      .map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${esc(label(v, k))}</option>`)
      .join('');
}

function viewMedForm(id) {
  const existing = P().medicines.find((m) => m.id === id);
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
        <label>Chinese nickname (optional — shown big and spoken; if blank, the elder sees the packet number, e.g. 3号药)
          <input name="nicknameZh" value="${esc(med.nicknameZh)}" placeholder="e.g. 降血糖药 / 白色小粒"></label>
        <label>Photo of pill or packet
          <input type="file" name="photo" accept="image/*" capture="environment"></label>
        <div class="photo-preview">${med.photo ? photoHtml(med) : ''}</div>
        ${med.photo ? '<label class="check"><input type="checkbox" name="removePhoto"> Remove photo</label>' : ''}
      </fieldset>

      <fieldset>
        <legend>How to take it</legend>
        <div class="row">
          <label>Amount each time <input name="doseQty" type="number" min="0.5" step="0.5" required value="${med.doseQty ?? ''}" placeholder="e.g. 1"></label>
          <label>Unit <select name="unit" required>${options(UNITS, med.unit, (v, k) => `${v.en[1]} · ${v.zh}`)}</select></label>
        </div>
        <div class="row route-only">
          <label>Where does it go? <select name="route" required>${options(ROUTES, med.route)}</select></label>
          <label class="side-only">Which side? <select name="side" required>${options(SIDES, med.side)}</select></label>
        </div>
        <label>How often <select name="frequency" required>${options(FREQUENCIES, med.frequency)}</select></label>
        <label>Food <select name="food" required>${options(FOOD, med.food, (v, k) => k === 'NONE' ? 'Not stated on label / any time' : `${v.en} food · 饭${v.zh}`)}</select></label>
        <div class="prn-only">
          <label>If only when needed — for what?
            <select name="prnReason" required>${options(PRN_REASONS, med.prnReason)}</select></label>
          <div class="row">
            <label>Most per day (from label) <input name="maxPerDay" type="number" min="1" max="50" step="1" value="${med.maxPerDay ?? ''}" placeholder="e.g. 8"></label>
            <label>Hours apart, at least (from label) <input name="minHours" type="number" min="1" max="48" step="1" value="${med.minHours ?? ''}" placeholder="e.g. 4"></label>
          </div>
          <p class="muted field-note">Copy these from the label. If the label gives no limit, ask the pharmacist — don't guess.</p>
        </div>
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
  dispensedOn: 'date dispensed', endDate: 'end date', route: 'where it goes', side: 'which side',
  maxPerDay: 'most per day', minHours: 'hours apart',
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
  syncMedForm(form);
  if (values.side != null && form.elements.side) form.elements.side.value = values.side;
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
    const readText = label?.ocr_text?.trim()
      ? `<details class="ocr-text"><summary>What the scanner read 识别的文字 (${label.ocr_confidence}% sure)</summary><pre>${esc(label.ocr_text.trim())}</pre></details>`
      : '';
    if (result.unreadable) {
      status.className = 'scan-error';
      status.textContent = 'This does not look like a readable medicine label. Try a clearer photo, or type the details in.';
      review.innerHTML = readText;
      review.classList.toggle('hidden', !readText);
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
        ${readText}
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

// Show only the fields that apply, and disable the rest so a hidden
// required field can't block saving (and isn't saved).
function syncMedForm(form) {
  const show = (sel, on) => {
    const el = form.querySelector(sel);
    el.classList.toggle('hidden', !on);
    for (const c of el.querySelectorAll('input, select')) c.disabled = !on;
  };
  const unit = form.elements.unit.value;
  show('.route-only', needsRoute(unit));
  // Only the routes that fit this unit (no "eye" for an inhaler).
  for (const o of form.elements.route.options) {
    const r = ROUTES[o.value];
    o.hidden = !!r && r.for !== 'both' && r.for !== unit;
  }
  if (form.elements.route.selectedOptions[0]?.hidden) form.elements.route.value = '';
  show('.side-only', needsRoute(unit) && !!ROUTES[form.elements.route.value]?.sided);
  show('.prn-only', form.elements.frequency.value === 'PRN');
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
  const existing = P().medicines.find((m) => m.id === id);
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const med = {
    ...(existing ?? { ...blankMedicine(todayStr()), number: takeNumber(state) }),
    id,
    nameEn: fd.get('nameEn').trim(),
    strength: fd.get('strength').trim(),
    nicknameZh: fd.get('nicknameZh').trim(),
    doseQty: Number(fd.get('doseQty')),
    unit: fd.get('unit'),
    frequency: fd.get('frequency'),
    food: fd.get('food'),
    // Hidden (disabled) fields are not in the form data: they don't apply.
    prnReason: fd.get('prnReason') ?? '',
    route: fd.get('route') ?? '',
    side: fd.get('side') ?? '',
    maxPerDay: num(fd.get('maxPerDay')),
    minHours: num(fd.get('minHours')),
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

  P().medicines = existing
    ? P().medicines.map((m) => (m.id === id ? med : m))
    : [...P().medicines, med];
  persist();
  location.hash = '#/meds';
}

// ---------- routine ----------

function viewRoutine() {
  const r = P().routine;
  const field = (key, en, zh) =>
    `<label>${zh} ${en} <input type="time" name="${key}" required value="${esc(r[key])}"></label>`;
  return `${nav('#/routine')}
  <main>
    <form id="routine-form" class="card form">
      <h2>Daily routine <span class="zh">作息时间</span></h2>
      <p class="muted">Vague label wording like "twice daily, after food" is turned into clock times using these.</p>
      <label>Name 名字 (shown on the schedule and elder view) <input name="name" value="${esc(P().name)}" placeholder="e.g. Ah Ma / 婆婆"></label>
      <div class="row">
        ${field('wake', 'Wake up', '起床')}
        ${field('breakfast', 'Breakfast', '早餐')}
      </div>
      <div class="row">
        ${field('lunch', 'Lunch', '午餐')}
        ${field('dinner', 'Dinner', '晚餐')}
      </div>
      ${field('bed', 'Bedtime', '睡觉')}
      <fieldset class="setting">
        <legend>Elder view 老人模式</legend>
        <label class="check"><input type="checkbox" name="elderBilingual" ${state.settings?.elderBilingual ? 'checked' : ''}>
          Bilingual version (English + 中文) 双语版本</label>
        <p class="muted">Turn on if a helper or family member who reads English, but not Chinese, uses the elder view. Off: Chinese only, with the English medicine name in small print.</p>
      </fieldset>
      ${usingAiReader() ? `<label>Label reading access code (if you were given one)
        <input name="accessCode" autocomplete="off" value="${esc(state.settings?.accessCode)}"></label>` : ''}
      <div class="toolbar">
        <button class="primary" type="submit">Save</button>
      </div>
      <hr>
      <p class="muted">Data is stored only in this browser.</p>
      <div class="toolbar">
        ${state.profiles.length > 1
          ? `<button type="button" class="danger" id="delete-profile">Remove ${esc(profileName(P()))} and their medicines</button>`
          : ''}
        <button type="button" class="danger" id="reset">Clear all data (everyone)</button>
      </div>
    </form>
  </main>`;
}

// ---------- elder view ----------

// Couples often share one phone: ask who is using it before showing
// anyone's medicines, so nobody takes their spouse's.
function viewElderPicker() {
  return `<div class="elder">
    <header class="elder-top">
      <div class="elder-date">你是谁？ <small>Who are you?</small></div>
      <a class="elder-exit" href="#/schedule">Exit 退出</a>
    </header>
    <div class="who-list">
      ${state.profiles.map((p) => `<button class="who" data-elder-pick="${p.id}">👤 ${esc(profileName(p))}</button>`).join('')}
    </div>
  </div>`;
}

// The automatic "Now" screen remembers what it last showed, so the update
// timer only redraws when that changes. elderHold keeps the shown part of
// the day in place right after a tap, so a card never vanishes mid-use.
let elderShown = { key: '' };
let elderHold = null;

function elderNowInfo() {
  const today = todayStr();
  const now = nowHHMM();
  const sched = buildSchedule(P().medicines, P().routine, today);
  const info = elderNow(sched, P().routine, now, P().taken[today] || {});
  const shown = sched.slots.find((s) => s.slot === info.slot);
  const statuses = shown ? groupByTime(shown.items).map((g) => groupStatus(g.time, now)) : [];
  return { info, key: JSON.stringify([today, P().id, info, statuses]) };
}

function isAutoElderRoute() {
  const [, route, param] = (location.hash || '').split('/');
  return route === 'elder' && (param === 'now' || (!param && state.profiles.length === 1));
}

function viewElder(slotParam) {
  if (!slotParam && state.profiles.length > 1) return viewElderPicker();
  if (slotParam === 'now') slotParam = undefined;
  const auto = !slotParam;
  const today = todayStr();
  const now = nowHHMM();
  const { slots, asNeeded } = buildSchedule(P().medicines, P().routine, today);
  let slot = slotParam;
  let nowInfo = null;
  if (auto) {
    const { info, key } = elderNowInfo();
    nowInfo = info;
    slot = elderHold ?? info.slot;
    elderShown = { key, slot };
  }
  const current = slots.find((s) => s.slot === slot);
  const taken = P().taken[today] || {};
  const d = new Date();

  const refillDue = P().medicines.filter((m) => {
    const info = refillInfo(m, today);
    return info && info.status !== 'ok';
  });

  // Chinese-first. The English drug name is always shown small (for clinic
  // visits); the bilingual setting adds English instructions for helpers.
  const bilingual = !!state.settings?.elderBilingual;
  const medRow = (med, slot, detail, detailEn, limit, early) => {
    const key = slot ? `${med.id}:${slot}` : null;
    const done = key && !!taken[key];
    return `<div class="elder-row ${done ? 'done' : ''}">
      ${medIcon(med, 'elder-photo')}
      <div class="elder-text">
        <div class="elder-name">${esc(medName(med).zh)}</div>
        <div class="elder-en-name">${esc(medName(med).en)}</div>
        <div class="elder-dose">${detail}</div>
        ${bilingual ? `<div class="elder-en">${esc(detailEn)}</div>` : ''}
        ${limit ? `<div class="elder-limit">⚠️ ${esc(limit.zh)}${bilingual ? `<small>${esc(limit.en)}</small>` : ''}</div>` : ''}
        ${warningsHtml(med, bilingual)}
      </div>
      <div class="elder-buttons">
        <button class="big listen" data-speak="${med.id}"${slot ? ` data-slot="${slot}"` : ''}>🔊 听</button>
        ${key ? `<button class="big take${early && !done ? ' take-later' : ''}" data-take="${key}"${early && !done ? ' data-early="1"' : ''}${done ? ' data-done="1"' : ''}>${done ? takenWords(med.unit).done : takenWords(med.unit).ask}</button>` : ''}
      </div>
    </div>`;
  };

  const groupCard = (g) => {
    const h = groupHeading(g);
    const headEn = h.en || SLOTS[g.slot].en;
    return `<section class="elder-card">
      <h2 class="elder-group-head"><b>${esc(h.zh || SLOTS[g.slot].zh)}</b> <span>${h.time}</span>${bilingual ? `<small>${esc(headEn)}</small>` : ''}</h2>
      ${auto ? (groupStatus(g.time, now) === 'now'
        ? `<p class="pill pill-now">现在吃${bilingual ? ' · Take now' : ''}</p>`
        : `<p class="pill pill-later">还没到时间${bilingual ? ' · Not yet' : ''}</p>`) : ''}
      ${g.items.map((i) => medRow(i.med, i.slot,
        esc(doseAction(i.med).zh), doseAction(i.med).en, null, groupStatus(g.time, now) === 'later')).join('')}
    </section>`;
  };

  return `<div class="elder">
    <header class="elder-top">
      <div class="elder-date">${d.getMonth() + 1}月${d.getDate()}日 ${ZH_WEEKDAYS[d.getDay()]}</div>
      <a class="elder-exit" href="#/schedule">Exit 退出</a>
    </header>
    ${P().name || state.profiles.length > 1 ? `<div class="elder-who">
      <span>👤 ${esc(profileName(P()))}</span>
      ${state.profiles.length > 1 ? '<a class="button" href="#/elder">换人 Switch</a>' : ''}
    </div>` : ''}
    ${refillDue.length ? `<button class="elder-refill" data-speak-text="${esc(MISC.REFILL_SOON.zh)}">
      🔔 ${MISC.REFILL_SOON.zh} 🔊
      <small>${refillDue.map((m) => `${m.number}${MISC.NUMBER_SUFFIX.zh}${m.nicknameZh ? ` ${esc(m.nicknameZh)}` : ''}`).join('、')} · ${MISC.REFILL_SOON.en}</small>
    </button>` : ''}
    ${auto ? '<details class="other-times"><summary>看其他时间 <small>Other times</small></summary>' : '<a class="button back-now" href="#/elder/now">← 现在 <small>Back to now</small></a>'}
    <nav class="elder-slots">
      ${slots.map((s) => {
        const all = s.items.every((i) => taken[`${i.med.id}:${i.slot}`]);
        return `<a href="#/elder/${s.slot}" class="${!auto && s.slot === slot ? 'active' : ''}">${SLOTS[s.slot].icon}<br>${SLOTS[s.slot].zh}${all ? ' ✓' : ''}${bilingual ? `<small>${SLOTS[s.slot].en}</small>` : ''}</a>`;
      }).join('')}
      ${asNeeded.length ? `<a href="#/elder/prn" class="${slotParam === 'prn' ? 'active' : ''}">⚠️<br>需要时${bilingual ? '<small>If needed</small>' : ''}</a>` : ''}
    </nav>
    ${auto ? '</details>' : ''}
    <main class="elder-main">
      ${slotParam === 'prn'
        ? `<section class="elder-card">
            <h2 class="elder-group-head"><b>需要的时候才吃</b>${bilingual ? '<small>Only when needed</small>' : ''}</h2>
            ${asNeeded.map((med) => {
              const reason = PRN_REASONS[med.prnReason] ?? PRN_REASONS.PRN_GENERIC;
              return medRow(med, null,
                `${esc(reason.zh)}，${esc(doseAction(med).zh)}`,
                `${reason.en} · ${doseAction(med).en}`, limitPhrase(med));
            }).join('')}
          </section>`
        : `${auto && nowInfo.missed.length ? `<div class="elder-missed">
              ⚠️ ${nowInfo.missed.map((m) => `<a href="#/elder/${m.slot}">${SLOTS[m.slot].zh}</a>`).join('、')}的药还没打勾
              <small>不确定请问家人${bilingual ? ' · Not ticked yet — ask family if unsure' : ''}</small>
            </div>` : ''}
          ${current
            ? groupByTime(current.items).map(groupCard).join('')
            : !slots.length
              ? '<p class="elder-empty">今天没有药 · No medicines today</p>'
              : nowInfo?.allDone
                ? `<p class="elder-done">✓ 今天的药吃完了${bilingual ? '<small>All done for today</small>' : ''}</p>`
                : `<p class="elder-empty">今天没有其他药了${bilingual ? '<small>No more medicines today</small>' : ''}</p>`}`}
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

  const medForm = app.querySelector('#med-form');
  if (medForm) {
    medForm.addEventListener('change', () => syncMedForm(medForm));
    syncMedForm(medForm);
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

// A large two-button question for the elder view; the browser's own
// confirm() box is small and shows in the phone's language.
function askElder(zh, en, yes, no) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'elder-dialog';
    wrap.innerHTML = `<div class="elder-dialog-box" role="alertdialog" aria-modal="true" aria-labelledby="ask-q">
      <p id="ask-q" class="ask-q">${esc(zh)}</p><p class="ask-en">${esc(en)}</p>
      <div class="ask-buttons"><button class="big ask-no">${esc(no)}</button><button class="big ask-yes">${esc(yes)}</button></div>
    </div>`;
    const done = (ok) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      resolve(ok);
    };
    const onKey = (e) => e.key === 'Escape' && done(false);
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('.ask-yes')) done(true);
      else if (e.target.closest('.ask-no') || e.target === wrap) done(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('.ask-no').focus(); // the safe answer is the default
  });
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
  const findMed = (id) => P().medicines.find((m) => m.id === id);
  const d = el.dataset;

  if (el.id === 'print') window.print();
  else if (el.id === 'sample') {
    P().medicines = sampleMedicines(todayStr(), [{ number: state.lastNumber || 0 }, ...allMedicines(state)]);
    syncLastNumber(state);
    if (!P().name) P().name = 'Ah Ma';
    persist();
    render();
  } else if (el.id === 'reset') {
    if (confirm('Delete EVERYONE\'s medicines, routines and settings stored in this browser?\n删除所有人的资料？\n\nNumbers written on packets will no longer match. This cannot be undone.')) {
      state = emptyState();
      persist();
      location.hash = '#/schedule';
      render();
    }
  } else if (d.profile) {
    state.activeId = d.profile;
    persist();
    render();
  } else if (el.id === 'add-profile') {
    const name = prompt('Name of the person you care for (e.g. Ah Gong / 公公):');
    if (name === null) return;
    const p = newProfile(name.trim());
    state.profiles.push(p);
    state.activeId = p.id;
    persist();
    location.hash = '#/routine'; // set their own meal and bed times first
    render();
  } else if (el.id === 'delete-profile') {
    const p = P();
    if (confirm(`Remove ${profileName(p)} and all their medicines?\n删除${profileName(p)}的资料？\n\nThis cannot be undone.`)) {
      state.profiles = state.profiles.filter((x) => x.id !== p.id);
      state.activeId = state.profiles[0].id;
      persist();
      location.hash = '#/schedule';
      render();
    }
  } else if (el.id === 'clear-meds') {
    const p = P();
    if (confirm(`Remove all of ${profileName(p)}'s medicines?\n删除${profileName(p)}的所有药物？\n\nTheir name and routine are kept. New medicines get new numbers, so cross out old numbers on packets. This cannot be undone.`)) {
      p.medicines = [];
      p.taken = {};
      persist();
      render();
    }
  } else if (d.elderPick) {
    state.activeId = d.elderPick;
    persist();
    location.hash = '#/elder/now';
  } else if (d.ics) downloadIcs(findMed(d.ics));
  else if (d.speak) speak(speakText(findMed(d.speak), d.slot));
  else if (d.speakText) speak(d.speakText);
  else if (d.take) {
    const toggle = () => {
      if (isAutoElderRoute()) elderHold = elderShown.slot ?? null; // don't jump right after a tap
      const today = todayStr();
      const day = (P().taken = { [today]: P().taken[today] || {} })[today]; // keep only today
      day[d.take] = !day[d.take];
      persist();
      render();
    };
    // Ticking early, or unticking, is easy to do by accident and makes a dose
    // look taken (or not) when it wasn't: ask first, in large type.
    if (d.early) askElder('还没到时间，确定用过了吗？', 'Not time yet — was it really taken?', '是 Yes', '不是 No').then((ok) => ok && toggle());
    else if (d.done) askElder('取消打勾吗？', 'Untick this dose?', '取消打勾 Untick', '不要 Keep').then((ok) => ok && toggle());
    else toggle();
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
      P().medicines = P().medicines.filter((m) => m.id !== d.delete);
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
    P().name = fd.get('name').trim();
    for (const k of ['wake', 'breakfast', 'lunch', 'dinner', 'bed']) P().routine[k] = fd.get(k);
    state.settings = { ...state.settings, elderBilingual: fd.has('elderBilingual') };
    if (fd.has('accessCode')) state.settings.accessCode = fd.get('accessCode').trim();
    persist();
    location.hash = '#/schedule';
  }
});

window.addEventListener('hashchange', () => {
  elderHold = null;
  render();
});

// ---------- elder "Now" screen: keep it up to date ----------
// Rule 1: only redraw when what it should show changes (part of the day,
//         now/not-yet, ticks, date) — a few times a day, not every minute.
// Rule 2: never move a screen someone chose (a tab, or the picker).
// Rule 3: wait while the screen was touched in the last 30 s or audio plays.
// performance.now() is unaffected by the phone's clock being changed.
let lastTouch = -Infinity;
document.addEventListener('pointerdown', () => { lastTouch = performance.now(); }, true);

function refreshElderNow() {
  if (!isAutoElderRoute()) return; // rule 2
  if (document.querySelector('.elder-dialog')) return; // a question is open
  if (performance.now() - lastTouch < 30000) return; // rule 3
  if ('speechSynthesis' in window && speechSynthesis.speaking) return; // rule 3
  const { key } = elderNowInfo();
  if (key === elderShown.key && !elderHold) return; // rule 1
  elderHold = null;
  render();
}

setInterval(refreshElderNow, 60000);
// Timers pause while the screen is off, so check as soon as the phone wakes.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshElderNow();
});
if ('speechSynthesis' in window) speechSynthesis.getVoices(); // warm up voice list
render();
