# MedSchedule 吃药时间表

Older Singaporeans who cannot read English receive medicine labels that are English-only and vague ("twice daily, after food"). Caregivers end up handwriting translations on every packet.

MedSchedule turns a person's medicines — from any clinic — into **one large-print, bilingual (English + 简体中文) daily schedule**, with a simple phone view the elder can use on their own, spoken instructions, and refill reminders.

**Live app:** https://evanyilun-byte.github.io/medschedule/

> Prototype for a school/portfolio project. It is an aid, not medical advice — always check with a pharmacist.

## What it does

| Caregiver | Elder |
|---|---|
| **📷 Scans each label** (free, on the phone) and checks the filled-in details | Opens **老人模式 Elder view**: sees what to take *now*, in big Chinese text with pill photos |
| Writes each medicine's **number** (①②③) on its packet with a marker — no translating | Matches the big number on screen to the number on the packet |
| Sets the daily routine once (meal and bed times) — vague label wording becomes clock times | Taps **🔊 听** to hear the instruction in Mandarin |
| Prints a large-print A4 schedule for the fridge | Taps **我吃了** to tick off each dose |
| Gets **refill reminders** before each medicine runs out, and can add them to their phone calendar | Sees a "药快吃完了" banner when a refill is due |
| Can switch the elder view to a **bilingual version** (Routine page) when a helper who reads English, not Chinese, gives the medicines | Chinese-first screen; the English medicine name is always shown small, for clinic visits |

Try it: open the app and press **Load example patient**.

## Key design decision: nothing is machine-translated

All Chinese text and audio come from a fixed, reviewable phrase library ([`js/phrases.js`](js/phrases.js)). Medicines are stored as codes (`BD`, `AFTER`, `WARN_DROWSY`…), so the same label always produces the same Chinese, and every phrase can be checked once by a native speaker or pharmacist. Label reading only fills in these codes, and the caregiver must confirm them.

## Packet numbers instead of stickers

Most families don't have a sticker printer, and many have no printer at all. Instead, each medicine gets a permanent number. The caregiver writes it on the packet with a marker, and the same number appears on the photo in the elder view, on the printed schedule, and in the audio ("三号药，早餐前，吃一粒…"). The elder only needs to match a number, which works even with low literacy. Numbers are never reused or reshuffled, so a marked packet stays correct.

## How it works

```
index.html          app shell
js/phrases.js       phrase library (EN + 中文), quantity wording
js/scheduler.js     (medicines, routine, date) → daily schedule   — pure, tested
js/refill.js        run-out date + reminder date, .ics export      — pure, tested
js/ocr.js           free on-device text reading (Tesseract.js)
js/labelParser.js   label text → codes, Singapore label rules       — pure, tested
js/extract.js       answer checking before it reaches the form     — pure, tested
js/storage.js       browser storage + example patient
js/app.js           views: schedule/print, medicines, routine, elder view
css/styles.css      large-print screen, phone and A4 print styles
tests/              88 unit tests
```

- **No build step, no server.** Plain HTML/CSS/JavaScript modules, hosted free on GitHub Pages.
- **Privacy:** all data, including label photos, stays in the browser on that device (no accounts, nothing sent anywhere).
- **Free:** no paid services or API keys.
- **Scheduling:** `BD + after food` → after breakfast and after dinner; `TDS + before food` → 30 min before each meal; `ON` → bedtime. Times come from the person's routine.
- **Refills:** `run-out = dispensed date + ⌊quantity ÷ (dose × doses per day)⌋`; reminder 7 days before (adjustable). No reminder for "when needed" medicines or short courses that end first. "I counted…" lets the caregiver correct the count.
- **Audio:** uses the browser's built-in Mandarin text-to-speech for now.

## Label reading (photo → details), free and on-device

The caregiver taps **📷 Scan label**, and the form fills itself in from the photo:

1. **Read the text:** [Tesseract.js](https://github.com/naptha/tesseract.js), an open-source text reader (OCR), runs inside the browser ([`js/ocr.js`](js/ocr.js)). The photo is greyed and contrast-boosted first. The first scan downloads the reader (~5 MB); later scans take a few seconds. **The photo never leaves the phone.**
2. **Understand it:** a rule-based parser ([`js/labelParser.js`](js/labelParser.js)) turns label wording into codes. It handles Singapore label styles: "TAKE 1 TABLET(S) 2 TIME(S) A DAY AFTER FOOD", shorthand (OM / ON / BD / TDS / PC / AC / PRN), "QTY: 60 TAB", day-first dates, "FOR 5 DAYS" / "X 5/7", warnings, and common OCR slips (O↔0, I↔1). Deterministic: the same text always gives the same result.
3. **Check it:** [`js/extract.js`](js/extract.js) replaces anything unknown or odd (impossible doses, future dates) with safe defaults and flags it. Anything the parser couldn't find, or a blurry photo, is flagged too.
4. **Caregiver confirms:** flagged fields are highlighted ⚠️, the label photo and its instruction wording are shown above the form, and **nothing can be saved until the caregiver ticks "I have checked every detail against the label"**.

**Known limits:** curved bottles, glare, handwriting and unusual label layouts read poorly. That's why the review step is compulsory and every field stays editable.

**Optional AI reader.** [`supabase/functions/read-label`](supabase/functions/read-label/index.ts) is a drop-in alternative that sends the photo to Claude through a small backend (paid API usage, not deployed for this prototype). Setting `READ_LABEL_URL` in [`js/config.js`](js/config.js) switches the Scan button to it, and its answers go through the same checks and review. To deploy: `supabase functions deploy read-label --project-ref <ref> --use-api`, with secrets `ANTHROPIC_API_KEY` and optionally `ACCESS_CODE`.

## Run locally

Any static file server works:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

**Tests:** open <http://localhost:8000/tests/> in a browser, or with Node installed run `npm test`.

## Roadmap

See [PLAN.md](PLAN.md) for the full plan.

- [x] M1 — Manual entry, scheduler, printable bilingual schedule
- [x] Refill reminders (run-out date, alerts, calendar export)
- [x] Elder view (Now/slot screens, listen, tick off) — single device
- [x] M2 — Free on-device label scanning (OCR + rule parser) → caregiver review
- [x] Packet numbers (write on packet, matched in elder view, schedule and audio)
- [ ] Share link so the elder's own phone gets the schedule
- [ ] Recorded/cloud TTS audio clips; dialects (Hokkien, Cantonese)
- [ ] Evaluation: scanning accuracy on ~30 mock labels, usability sessions
- [ ] Future ideas: dose tracker on the caregiver's phone, caregiver voice notes (dialects), pillbox-filling guide
