# Grid Games

Daily logic puzzles in a social-feed layout: **Queens, Tango, Zip, Mini Sudoku**.
Sign in with Google, connect with friends through invite links, compare times on a shared leaderboard.

## How it stays fair
- **Same difficulty every day.** Each puzzle must be solvable by pure logic (no guessing, single solution)
  and its difficulty score must fall inside `BANDS` in `games.js`. `node test.mjs 365` checks a whole year.
- **Server owns the game.** Puzzles are generated from a secret seed and stored in Firestore; the browser
  never receives the solution. The timer starts on the server when you press Start, survives reloads,
  and only the first solve counts. Answers are validated on the server. Hints are counted (💡).

## Run locally
```bash
npm install
gcloud emulators firestore start --host-port=127.0.0.1:8085   # separate terminal
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 DEV_LOGIN=1 npm start   # http://localhost:8080
```
`DEV_LOGIN=1` adds a name-only login for testing. The server refuses to start with it on Cloud Run.

## Deploy (Cloud Run + Firestore, same project as your other apps)
1. Firestore: `gcloud firestore databases create --location=europe-west1` (skip if the project already has one).
2. Google sign-in: Console → APIs & Services → Credentials → Create OAuth client ID → Web application.
   Add your Cloud Run URL (and any custom domain) to **Authorized JavaScript origins**.
3. First deploy (sets the config once):
```bash
gcloud run deploy grid-games --source . --region europe-west1 --allow-unauthenticated \
  --set-env-vars GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com,SECRET=$(openssl rand -hex 32)
```
4. Later deploys keep those env vars: `gcloud run deploy grid-games --source . --region europe-west1`.
   Never change `SECRET` afterwards: it signs sessions and seeds puzzles.
The Cloud Run service account needs the **Cloud Datastore User** role (the default compute account has it).
