# MedSchedule — Build Plan

Turns a person's medicine labels (from any clinic) into one large-print, bilingual (English + Simplified Chinese) daily schedule, with spoken Mandarin audio for the elder.

**Project type:** school / portfolio · **Input:** photo + AI, caregiver confirms · **Users:** caregiver + elder · **Language:** Simplified Chinese + audio

---

## 1. Users and what each one does

| | Caregiver (adult child, helper) | Elder |
|---|---|---|
| Device | Own phone / laptop | Own phone (or printed sheet) |
| Does | Photographs labels, sets routine, reviews, prints, shares | Sees "what to take now", taps to hear it, ticks "taken" |
| Needs | Speed, trust that it's correct | Huge text, pictures, audio, zero setup |

The elder never logs in. The caregiver shares a **link / QR code** that opens the elder's read-only view.

## 2. Core flow

1. **Set routine** (once): wake, breakfast, lunch, dinner, bed times.
2. **Add medicines**: photograph each label → AI extracts fields → shown beside the photo.
3. **Review** (required): caregiver confirms or fixes each field; unclear fields are flagged and block confirmation.
4. **Schedule generated**: vague instructions mapped to concrete slots using the routine.
5. **Outputs**:
   - Printable A4 schedule (fridge copy).
   - Elder phone view with "Now" screen + audio.
6. **Update**: when prescriptions change, add/stop a medicine; schedule and elder view update.
7. **Refill**: app warns the caregiver before each medicine runs out (see §7a).

## 3. Key design decisions

**AI extracts, never translates.** The model returns structured codes (e.g. `frequency: BD`, `food: AFTER`). All Chinese text and audio come from a fixed, reviewed phrase library. Same input → same Chinese, every time, and every phrase can be checked by a pharmacist or native speaker.

**Medicine names stay English + photo + caregiver nickname.** Chinese drug names are unreliable to auto-translate; elders recognise pills by look. The caregiver adds an optional Chinese nickname (e.g. 降血压药, 白色小粒) used in the display and audio.

**Audio is composed from cached clips.** Because phrases are fixed, each one is generated once with a cloud TTS (Mandarin, zh-CN) and stored. A spoken instruction is a sequence: 早上 · 早餐后 · 吃一粒 · 降血压药. Cheap, consistent, works offline once cached. Nicknames are TTS'd on save. Dialects (Hokkien, Cantonese) are a stretch goal — the clip design supports adding them.

**Scheduling is a pure, tested function.** `(medicines, routine) → slots`. No AI involved. This is the safety-critical logic, so it gets thorough unit tests.

## 4. Architecture

```
Caregiver browser ──┐                     ┌── Claude API (vision, structured output)
                    ├── Next.js app ──────┼── Supabase (Postgres, Storage for photos/audio)
Elder browser ──────┘   (Vercel)          └── Cloud TTS (zh-CN) — phrase clips + nicknames
```

- **Next.js + TypeScript** (App Router), installable PWA, print stylesheet.
- **API route `/api/extract`**: sends label photo to Claude with a JSON schema; returns fields + per-field confidence. Key stays server-side.
- **Supabase**: auth for caregivers (email magic link), row-level security; elder view via unguessable share token.
- **Tailwind CSS**; elder view uses a separate, minimal design system (≥28px text, ≥64px tap targets, high contrast).

## 5. Data model

```
Person      id, display_name, routine{wake, breakfast, lunch, dinner, bed}, share_token
Medicine    id, person_id, name_en, strength, nickname_zh, photo_url,
            dose_qty, dose_unit, frequency_code, food_code, prn (bool), prn_reason_code,
            warning_codes[], start_date, end_date, status (draft|confirmed|stopped),
            qty_supplied, dispensed_on, qty_adjusted, adjusted_on, refill_lead_days (default 7)
DoseLog     id, medicine_id, slot, date, taken_at        (elder ticks)
Phrase      code, en, zh, audio_url                       (static library, JSON in repo)
```

Privacy (PDPA-minded): no NRIC, no full names required, no clinic/doctor data stored; label photos can be deleted after confirmation.

## 6. Phrase library (examples)

| Code | English | 中文 |
|---|---|---|
| `OD` | Once a day | 每天一次 |
| `BD` | Twice a day | 每天两次 |
| `TDS` | Three times a day | 每天三次 |
| `ON` | At night | 晚上 |
| `AFTER` | After food | 饭后 |
| `BEFORE` | Before food | 饭前 |
| `WITH` | With food | 吃饭时 |
| `PRN_PAIN` | Only when in pain | 痛的时候才吃 |
| `WARN_DROWSY` | May cause drowsiness | 会让人想睡觉 |
| `WARN_COMPLETE` | Finish the whole course | 要吃完全部 |
| `REFILL_SOON` | Running out soon — get more | 药快吃完了，要去拿药 |

Mapping rules (in the scheduler), e.g. `BD + AFTER` → after breakfast, after dinner; `TDS + BEFORE` → 30 min before each meal; `ON` → bedtime.

## 7. Elder view

- **Now** screen: current slot (早上 / 中午 / 晚上 / 睡前), pill photos, big ▶ 听 (listen) button, big ✓ 我吃了 (I took it) button.
- **Today** screen: all slots, ticked ones greyed out.
- **Stretch**: web push reminders (PWA; iOS needs home-screen install), caregiver sees missed doses.

## 7a. Refill reminders

Kept deliberately simple: one pure function, no AI.

**Inputs**
- `qty_supplied` and `dispensed_on` — AI extracts these from the label (most SG labels print quantity, e.g. "60 TAB", and a dispense date); caregiver confirms in review like any other field.
- Daily usage — already known from the schedule (dose × times per day).
- Optional correction: caregiver taps "I counted, N left" → stored as `qty_adjusted` + `adjusted_on`, which replaces the starting point.

**Calculation** `runOutDate(medicine) → date | null`
```
start      = adjusted_on ?? dispensed_on
remaining  = qty_adjusted ?? qty_supplied
per_day    = dose_qty × doses_per_day
run_out    = start + floor(remaining / per_day) days
remind_on  = run_out − refill_lead_days        (default 7: time to book polyclinic/GP)
```
- Returns `null` (no reminder) for "only when needed" medicines, and for short courses whose `end_date` comes before `run_out` — those aren't meant to be refilled.

**Where it shows**
- **Caregiver home**: a "Refill soon" list sorted by run-out date, e.g. *Metformin — runs out Sat 12 Dec (6 days)*. Amber within lead time, red within 2 days.
- **Printout**: small line under each medicine: *Refill by 5 Dec / 12月5日前拿药*.
- **Elder view**: banner with 🔊 "药快吃完了，要去拿药" + pill photo, so the elder can tell the caregiver.
- **Calendar**: "Add to calendar" button downloads an `.ics` event on `remind_on` — gives real phone reminders with no push-notification setup.

**Tests**: per-day maths for every frequency, PRN → null, course ends before run-out → null, manual count overrides label quantity, half-tablet doses.

## 8. Milestones

| # | Milestone | Done when |
|---|---|---|
| M1 | Manual entry + scheduler + print view | Typed-in medicines produce a correct printable bilingual A4 sheet; scheduler unit-tested |
| M2 | Photo extraction + review screen | Photo → fields with flags; nothing reaches the schedule unconfirmed |
| M3 | Elder view + share link | Elder opens QR link, sees Now/Today, ticks doses |
| M3a | Refill reminders | Run-out dates correct and tested; shown on caregiver home, printout, elder banner; `.ics` export works |
| M4 | Audio | Every phrase and nickname plays; composed instructions sound natural |
| M5 | Evaluation + user testing | Results below written up |
| M6 | Polish + portfolio | README, demo video, write-up |

## 9. Evaluation (portfolio centrepiece)

- **Extraction accuracy**: build a test set of ~30 *mock* labels (made-up patients, styled like polyclinic/GP/hospital labels — never real patient data). Measure per-field accuracy and how often uncertain fields are correctly flagged.
- **Scheduler correctness**: unit tests for every frequency × food combination and edge cases (PRN, short courses, overlapping medicines).
- **Usability**: 3–5 sessions with an elder + caregiver pair. Can the elder say what to take now, unaided? Time for caregiver to set up 5 medicines vs. handwriting.
- **Translation review**: phrase library checked by a native speaker (ideally a pharmacist).

## 10. Safety and limits

- App is an aid, not medical advice; disclaimer on every printout ("Check with your pharmacist").
- Hard review gate before anything is scheduled.
- Unknown instructions are shown in English with "请问药剂师" (ask the pharmacist) rather than guessed.
- No dose calculations, no interaction checking — out of scope, stated explicitly.

## 11. Portfolio deliverables

- Public repo with README, architecture diagram, setup instructions.
- Write-up: problem, design decisions (especially "AI extracts, never translates"), evaluation results, what you'd do next.
- 2-minute demo video: photo → review → print → elder phone with audio.
