# TC-99 — Photo of a physical artifact → add a person (with the date + occasion it carries)

Parent: TC-95 (Universal contact import). Priority: P2 High. Pure-web, no native shell.

## Why this is not "just TC-98 again"
TC-98 reads *screens* (DM / profile / contact card / thread). TC-99 reads *physical things* — a
business card, wedding invite, save-the-date, birthday/greeting card, baby announcement, or an
obituary. The artifact **is** the trigger moment, and unlike a screenshot it almost always carries
the thing screens don't: an **event date + an occasion**. The epic note already says "the screenshot
path covers basic photos" — so the incremental value here is exactly: (1) capture the **date +
occasion**, (2) make **camera capture** first-class, (3) handle the **obituary / condolence** case
with care. Reuse everything else; never fork the pipeline.

## Reuse (do NOT rebuild)
- `netlify/functions/_extract_image.mjs` → `extractPersonFromImage()` — the multimodal extractor. Extend its schema + system prompt; keep model (`claude-sonnet-4-6`), temp 0, forced tool_choice, trust posture.
- `capture-image.mjs` endpoint → funnels every ExtractedPerson through the existing `resolvePerson` / preview / confirm pipeline. No new resolve-or-write logic.
- The confirm card (`renderImportConfirm` in `_capture.mjs` / `_capture.js`) + `captureExtract` client path (`public/companion.js`, the TC-98/100/101 import doors ~line 1016–1124).
- `normBday` / `BDAY_SENTINEL_YEAR` year-less-date handling (TC-112).

## Scope

### 1. Extraction: capture an EVENT (date + occasion), not just a birthday
Extend `EXTRACTED_PERSON_ITEM` / `EXTRACT_IMAGE_SCHEMA` in `_extract_image.mjs`:
- Add artifact `source_kind` enum values: `business_card`, `invitation`, `save_the_date`, `greeting_card`, `announcement`, `obituary` (keep the existing screen kinds).
- Add an **`event`** capture (per person, or per image applied to the resolved person): `{ occasion: string, date: "YYYY-MM-DD" | "--MM-DD" | null, recurring: boolean }`.
  - Wedding/save-the-date → one-time date, occasion "wedding". Baby announcement → birth date (birthday, recurring). Business card → usually no event (name/title/company/phone/email only). Greeting/birthday card → birthday if a date is printed.
  - Same trust rule as today: **only when literally shown; never infer a day/month/year.** Empty over guessed.
- `normalizeExtracted` maps a full/`--MM-DD` event date through `normBday`-style handling; a recurring event (birthday) seeds a recurring `key_date`, a one-time event (wedding) seeds a non-recurring `key_date` with the occasion as its label.

### 2. System prompt: teach it artifacts (a new EXTRACT_IMAGE_SYSTEM branch or additions)
- It now also reads a printed card/invite/announcement/obituary, not only a screen.
- Business card → the person is the card's owner (name, title, company as a note, email/phone identifiers).
- Invitation / save-the-date → the celebrant(s) + the event date + occasion. Two hosts (a couple) → `ambiguous_multi_person`, list each, never auto-pick.
- **Obituary — handle with care (the one real judgment call):** the user usually photographs an obituary to *show up for someone grieving*, not to "add the deceased." So: surface BOTH the deceased AND named surviving relatives as candidate people, tag the deceased's record's event as `occasion:"loss of <name>"` context, and let the confirm step ask **who are you showing up for?** — never auto-add the deceased as the person to remember, never auto-pick a survivor. Faithful-only (names/relations literally printed).

### 3. Camera capture is first-class (mobile web)
- The import door "Add from a screenshot or photo" currently opens a file picker. Add a **"Take a photo"** affordance using `<input type="file" accept="image/*" capture="environment">` so mobile opens the camera directly; keep the library/file path for desktop. One shared handler → same `extractPersonFromImage`.

### 4. Confirm-before-save shows the date + occasion
- The confirm card must render the extracted **occasion + date** and let the user accept/edit it as a `key_date` (recurring for birthdays, one-time for a wedding/event), consistent with the manual add-a-date UX. Year-less dates use the sentinel (no bogus year shown).
- Obituary path: the confirm asks who they're showing up for (deceased vs a named survivor the user knows), attaches the loss context as a note/date on the chosen person. Sensitive, quiet copy — no celebratory framing.

## Trust / quality bar (unchanged, enforce)
- Never invent a name, date, email, phone, or relationship. Empty over guess.
- Multi-person artifact (couple on an invite, family in an obituary) → `ambiguous_multi_person`, confirm each separately, never auto-batch.
- All copy human-typed (no em-dash / ellipsis-char AI tells — see TC-83/85). Obituary/condolence copy is gentle, never cheery.

## Out of scope (keep it clean)
- Audio (voice memo) capture = **TC-106** (different rail: transcribe → text extract). Follows.
- Guided one-question capture style = **TC-107** (UX layer). Follows / parallel.
- Native camera / share-sheet = TC-96/97 (gated on TC-108).

## Acceptance
- Photograph a business card → person added with name/title/company/phone/email, confirm-before-save. No event invented.
- Photograph a wedding invite / save-the-date → celebrant(s) + the wedding date (one-time key_date, occasion label), couple → confirm each.
- Photograph a birthday card with a printed date → birthday as a recurring key_date (year-less → sentinel).
- Photograph an obituary → offered the deceased + named survivors; user picks who they're showing up for; loss context attached quietly; nothing auto-picked.
- Camera opens directly on mobile ("Take a photo"); desktop still uses the file/library picker.
- Reuses resolvePerson dedup (email/phone strong key) + the shared confirm card; zero parallel write logic; keys stay server-side.

## Pipeline
Architect (this doc) → Builder (feature branch, worktree-isolated, NO prod deploy) → UX → Validator → David. Per repo rules: propose, don't auto-apply; no Supabase/prod mutations without David's approval.
