# Kshitij Sports Portal

React + TypeScript + Vite single-page app on Firebase Hosting. Firebase Authentication (Google only) and Firestore with security rules. One Cloudflare Worker (`kshitij-api`) exposes `POST /api/<operation>` and forwards the caller's Firebase ID token to the Firestore REST API, so Firestore rules decide every write. No Cloud Functions, no Firebase Admin SDK, no service account, no Worker secrets.

Operations and deployment guide: `docs/BACKEND_OPERATIONS_AND_DEPLOYMENT_RUNBOOK.md`. Short ordered checklist: `docs/PRODUCTION_INITIALIZATION_CHECKLIST.md`.

## Layout

- `shared/` — single domain module (types, Zod schemas, import validator, bracket engine, scoring models) used by both `src/` and `worker/`.
- `worker/` — Cloudflare Worker (`wrangler.toml`, `src/`). Production variables are `FIREBASE_PROJECT_ID` and `ALLOWED_ORIGIN`, plus the `MEDIA` KV namespace binding that stores gallery and committee images; `[env.local]` targets the emulators.
- `firebase/` — `firebase.json`, `firestore.rules`, `firestore.indexes.json`. Run Firebase CLI commands from this folder (the npm scripts already do).
- `src/` — frontend.
- `scripts/seed-demo-data.ts` — emulator-only demo seeding; refuses any project id not starting with `demo-`.

## Requirements

Node.js 22 or newer, npm 10+, Git, Java 21+ (Firestore emulator only).

## Local (emulators)

```bash
npm run install:all
npm run emulators
npm run seed:emulator
npm run dev:emulator
```

`npm run dev:emulator` loads `.env.emulator` (project `demo-kshitij`, `VITE_USE_EMULATORS=true`), which overrides any `.env.local`.
Run `npm run worker:dev` in a second terminal. Open http://127.0.0.1:5173 (not `localhost`, which the local Worker's CORS setting rejects), Emulator UI at http://localhost:4000. Local Super Admin: sign in with the fake Google account `admin@kshitij.test`.

## Production

Follow `docs/BACKEND_OPERATIONS_AND_DEPLOYMENT_RUNBOOK.md`. In order:

1. Link the project: `cd firebase && firebase use --add`, and log in to Wrangler with `npx wrangler login`. Create the media namespace with `cd worker && npx wrangler kv namespace create MEDIA` and put the printed id in the `[[kv_namespaces]]` entry of `worker/wrangler.toml`.
2. `npm run test:rules`, then `npm run deploy:rules`.
3. `npm run deploy:worker`, then put the printed Worker origin in `.env.production` as `VITE_API_BASE_URL` (no trailing slash, no `/api`).
4. `npm run deploy:hosting`.
5. Create `admins/{lower-cased-email}` with role `SUPER_ADMIN` in the Firestore console.

Never set `VITE_USE_EMULATORS` for a production build.

## Scripts

| Script | Purpose |
| --- | --- |
| `dev` | Vite dev server using `.env.local` (real Firebase project) |
| `dev:emulator` | Vite dev server wired to emulators |
| `build` | Type-check and production build to `dist/` |
| `typecheck:all` | Frontend, Worker and scripts type-check |
| `test` / `test:worker` / `test:all` | Vitest for the frontend and shared code / the Worker / both |
| `test:rules` | Firestore rules tests against the emulator (needs Java) |
| `worker:dev` | Run the Worker locally with `[env.local]` |
| `worker:build` | Dry-run Worker bundle |
| `emulators` | Emulator Suite, state discarded on exit |
| `emulators:persist` / `emulators:restore` | Save state to `firebase/emulator-data` on exit (first run) / load it and keep saving (later runs) |
| `seed:emulator` | Seed demo data into the running emulator |
| `deploy:rules` | Deploy Firestore rules and indexes |
| `deploy:worker` | Deploy the Worker with Wrangler |
| `deploy:hosting` | Build and deploy to Firebase Hosting |

## Known open issues

- `completeMatch`'s `winnerSlot` is `"A" | "B"` only; no path yet for a chess/carrom draw or cricket tie to advance a bracket.
