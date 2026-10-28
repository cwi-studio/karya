# Karya Go — speak a ticket from your phone

Date: 29 Oct 2026 · Branch `karya-go` · Status: building (founder: "go ahead", questions skipped)

## Why

Karya is only usable at a desk. The founder and business people want a phone app they stay logged into, where a
ticket is one tap and one sentence: "Mayank, the fee receipt PDF is cutting off the school logo, urgent, by Friday"
becomes a ticket in the right project, assigned, prioritised, due Friday.

## What it is

A separate, small mobile web app at **`karya.cwistudio.in/go/`**, installable to the home screen as **Karya Go**.
It talks to the same Karya API with the same login cookie. It is not a responsive re-skin of the full Karya UI
(upstream Plane's web app is desktop-first and too heavy to make phone-friendly without forking hundreds of files).

### Goals

- Open → tap mic → speak → review → Create. Under 15 seconds for a typical ticket.
- Hindi, English and Hinglish speech; the ticket is written in English.
- The spoken sentence fills: title, description, assignees, priority, due date, module.
- Typing works the same way (the typed sentence is parsed just like speech).
- "My work": open items assigned to me, tap to open in full Karya.
- Screenshots, photos and files on the ticket (founder, 29 Oct): pick from the gallery, take a photo, choose a
  file, paste from the clipboard, or share a screenshot straight from the phone's gallery into Karya Go.
- Installs on Android (Chrome) and iPhone (Safari → Add to Home Screen); stays signed in.

### Non-goals (v1)

- Not a full mobile Karya (no boards, cycles, pages, comments, settings).
- No offline ticket queue, no push notifications, no comments or status changes. (v2 list.)

### Anti-goals

- A ticket created silently with the wrong assignee or project. Every draft is shown before Create.
- Audio stored anywhere. It is forwarded once to the speech service and dropped.

## Decisions (Claude's calls unless noted)

| Decision          | Choice                                                                                                                                                                                                                                                                            | Why                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Where it lives    | new `apps/go` (Vite + React + Tailwind), built into the **web** image under `/go/`                                                                                                                                                                                                | no proxy or compose change, own small bundle, upstream merges untouched  |
| Speech capture    | `MediaRecorder` in the browser → server speech-to-text                                                                                                                                                                                                                            | iOS home-screen web apps have no `SpeechRecognition` (WebKit bug 225298) |
| Speech-to-text    | Sarvam `POST /speech-to-text`, `saaras:v3`, mode `codemix` (configurable)                                                                                                                                                                                                         | Indic + Hinglish, ₹30/hour of audio, accepts webm and mp4                |
| Understanding     | OpenAI-style chat completions with a JSON schema; default Sarvam `sarvam-105b`                                                                                                                                                                                                    | same vendor and key; any compatible endpoint (OpenRouter etc.) by env    |
| No LLM configured | the transcript becomes the title; fields picked by tap                                                                                                                                                                                                                            | app still works                                                          |
| Recording cap     | 30 s (Sarvam REST limit)                                                                                                                                                                                                                                                          | tickets are a sentence or two                                            |
| Creating          | the app calls upstream's own create endpoint, then upstream's module link                                                                                                                                                                                                         | activity log, notifications, approver guard all run as normal            |
| Attachments       | one `<input type=file multiple>` (iOS and Android show Photo Library / Take Photo / Choose Files); upstream's own three-step upload (`/api/assets/v2/.../attachments/` → signed storage POST → PATCH) after the ticket exists, one file at a time with progress, retry on failure | same path and allow-list as the full app                                 |
| Big photos        | re-encoded on the phone as JPEG, longest side 2560 px, until under `FILE_SIZE_LIMIT` (5 MB default; sent in context)                                                                                                                                                              | phone photos are 6–12 MB                                                 |
| Share sheet       | manifest `share_target` POST `/go/share`, caught by the service worker, files parked in Cache Storage, app opens with them attached                                                                                                                                               | Android Chrome installs only; iOS has no Web Share Target                |
| Auth              | Karya session cookie; 401 → `/?next_path=/go/` (the sign-in form posts and the server redirects there)                                                                                                                                                                            | one login for both apps                                                  |

## Backend (`apps/api/plane/karya/`)

- `GET  /api/workspaces/<slug>/karya/go/context/` — me, voice on/off, the projects I am a member of, each with
  identifier, members, default state, modules.
- `POST /api/workspaces/<slug>/karya/go/draft/` — multipart `audio` **or** `text`, plus `project_id`. Returns
  `{transcript, draft: {title, description, assignee_ids, priority, target_date, module_id}}`. Only ids from that
  project are kept; anything the model invents is dropped. Rate limit 40 drafts / user / hour.
- `GET  /api/workspaces/<slug>/karya/go/mine/` — up to 50 open items assigned to me.
- Settings (env): `KARYA_GO_STT_URL`, `KARYA_GO_STT_KEY`, `KARYA_GO_STT_MODEL`, `KARYA_GO_STT_MODE`,
  `KARYA_GO_LLM_URL`, `KARYA_GO_LLM_KEY`, `KARYA_GO_LLM_MODEL`.

## App screens

1. **Sign-in gate** — Karya mark, "Sign in to Karya".
2. **New** (home) — project chip at top (last used remembered; tap = bottom sheet with search, grouped by
   workspace). A large coral mic button in the thumb zone: tap to record, tap again to stop; live level ring and a
   30 s countdown. Below: "or type it" field. A short hint line with an example sentence.
3. **Review** — the draft as an editable card: title, description, chips for assignees (avatars), priority, due date
   (Today / Tomorrow / Friday / pick), module, and a thumbnail strip of attachments with a "+ Photo/file" tile. The transcript is shown small and greyed. One big **Create ticket**.
4. **Done** — `BALAV2-412` created, assigned to Mayank; attachments upload with progress ("2 attachments added", or tap to retry). Buttons: Open in Karya · Share · New ticket.
5. **My work** — list of my open items with state colour, priority and due date; tap opens full Karya.

Bottom bar: New · My work. Coral `#ff7a59` on ink `#1c0f0b` (Karya brand), light and dark.

## PWA

`/go/manifest.webmanifest` (scope `/go/`, standalone, portrait, Karya icons) and `/go/sw.js`: precached shell,
network-first for `index.html`, cache-first for hashed assets, never caches `/api/`.

## Builder's latitude

Component structure, exact copy, animation, the LLM prompt wording, test layout.
