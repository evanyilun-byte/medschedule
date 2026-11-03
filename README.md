# MedSchedule 吃药时间表

Older Singaporeans who cannot read English receive medicine labels that are English-only and vague ("twice daily, after food"). Caregivers end up handwriting translations on every packet.

MedSchedule turns a person's medicines — from any clinic — into **one large-print, bilingual (English + 简体中文) daily schedule**, with a simple phone view the elder can use on their own, spoken instructions, and refill reminders.

**Live app:** https://evanyilun-byte.github.io/medschedule/

> Prototype for a school/portfolio project. It is an aid, not medical advice — always check with a pharmacist.

## What it does

| Caregiver | Elder |
|---|---|
| Enters each medicine from its label (name, dose, how often, before/after food) | Opens **老人模式 Elder view**: sees what to take *now*, in big Chinese text with pill photos |
| Sets the daily routine once (meal and bed times) — vague label wording becomes clock times | Taps **🔊 听** to hear the instruction in Mandarin |
| Prints a large-print A4 schedule for the fridge | Taps **我吃了** to tick off each dose |
| Gets **refill reminders** before each medicine runs out, and can add them to their phone calendar | Sees a "药快吃完了" banner when a refill is due |

Try it: open the app and press **Load example patient**.

## Key design decision: AI extracts, it never translates

All Chinese text and audio come from a fixed, reviewable phrase library ([`js/phrases.js`](js/phrases.js)). Medicines are stored as codes (`BD`, `AFTER`, `WARN_DROWSY`…), so the same label always produces the same Chinese, and every phrase can be checked once by a native speaker or pharmacist. The planned photo-reading step will use AI only to fill in these codes, with a mandatory caregiver review.

## How it works

```
index.html          app shell
js/phrases.js       phrase library (EN + 中文), quantity wording
js/scheduler.js     (medicines, routine, date) → daily schedule   — pure, tested
js/refill.js        run-out date + reminder date, .ics export      — pure, tested
js/storage.js       browser storage + example patient
js/app.js           views: schedule/print, medicines, routine, elder view
css/styles.css      large-print screen, phone and A4 print styles
tests/              57 unit tests
```

- **No build step, no server.** Plain HTML/CSS/JavaScript modules, hosted free on GitHub Pages.
- **Privacy:** all data stays in the browser on that device (no accounts, nothing sent anywhere).
- **Scheduling:** `BD + after food` → after breakfast and after dinner; `TDS + before food` → 30 min before each meal; `ON` → bedtime. Times come from the person's routine.
- **Refills:** `run-out = dispensed date + ⌊quantity ÷ (dose × doses per day)⌋`; reminder 7 days before (adjustable). No reminder for "when needed" medicines or short courses that end first. "I counted…" lets the caregiver correct the count.
- **Audio:** uses the browser's built-in Mandarin text-to-speech for now.

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
- [ ] M2 — Photo of label → AI extraction → caregiver review
- [ ] Share link so the elder's own phone gets the schedule
- [ ] Recorded/cloud TTS audio clips; dialects (Hokkien, Cantonese)
- [ ] Evaluation: extraction accuracy on mock labels, usability sessions
