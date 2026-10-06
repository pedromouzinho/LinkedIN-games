# Games@Work

Two-minute daily puzzles for the office, in a social-feed layout. Sign in with Google, connect with colleagues
through invite links, compare results on a shared leaderboard.

- **Logic:** Kings, Solo, Unzip, Holes, Maxi Sudoku.
- **Football:** Who Am I, Clues, Grid, Links, Bingo, Hot or Cold, Top 10.

`docs/analise-jogos.md` describes the reference games these are modelled on and what each one improves.

## How it stays fair
- **Same difficulty every day.** Each puzzle must be solvable by pure logic (no guessing, single solution)
  and its difficulty score must fall inside `BANDS` in `games.js`. `node test.mjs 365` checks a whole year.
- **Football puzzles have standards too** (`BANDS` in `football.js`): every Who Am I / Clues answer is the only
  player in the database that fits all clues, every Grid square has at least 3 well-known answers, every Links player
  fits exactly one group, every Bingo board can be completed from its first 25 players.
- **Server owns the game.** Puzzles are generated from a secret seed and stored in Firestore; the browser
  never receives the solution. The timer starts on the server when you press Start, survives reloads,
  and only the first solve counts. Answers are validated on the server. Hints are counted (💡).

## Football data
`data/football.json` is built from Wikidata (CC0): men's players with articles in 30+ Wikipedias, their clubs,
years, league games and goals, caps, position, nationality and height. Refresh it with
`NODE_USE_ENV_PROXY=1 node scripts/football-data.mjs` (about 10 minutes) and commit the result.
No player photos or club crests are used (image rights); shirts are drawn from the clubs' colours.

## Run locally
```bash
npm install
gcloud emulators firestore start --host-port=127.0.0.1:8085   # separate terminal
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 DEV_LOGIN=1 npm start   # http://localhost:8080
```
`DEV_LOGIN=1` adds a name-only login for testing. The server refuses to start with it on Cloud Run.

## Deploy (Cloud Run + Firestore, in a project of its own)
A separate project keeps Games@Work's data, quotas and bill apart from your other apps.
```bash
P=<project-id>; R=europe-west1
gcloud config set project $P
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com
gcloud firestore databases create --location=$R
```
1. Google sign-in (Console only): Google Auth Platform → Branding (app name, support email, links to `/privacy` and `/terms`),
   then Clients → Create client → Web application. Add the Cloud Run URL and your domain to **Authorized JavaScript origins**.
2. First deploy sets the config once. `--max-instances` caps what a traffic spike can cost:
```bash
gcloud run deploy games-at-work --source . --region $R --allow-unauthenticated --max-instances 3 \
  --set-env-vars "GOOGLE_CLIENT_ID=<id>.apps.googleusercontent.com,SECRET=$(openssl rand -hex 32),CONTACT_EMAIL=<you@example.com>,OPERATOR_NAME=<your name>"
```
3. Later deploys keep those env vars: `gcloud run deploy games-at-work --source . --region $R`.
   Never change `SECRET` afterwards: it signs sessions and seeds puzzles.
4. Your domain:
```bash
gcloud domains verify <domain>   # proves you own it (TXT record in your DNS)
gcloud beta run domain-mappings create --service games-at-work --domain <domain> --region $R
gcloud beta run domain-mappings describe --domain <domain> --region $R   # the DNS records to add at your registrar
```
   Free alternative (live now): Firebase Hosting puts **https://gamesatwork.web.app** in front of the service (`firebase.json`).
   Redeploy it with `npx firebase-tools deploy --only hosting` (only needed if `firebase.json` changes). Hosting passes on only the
   cookie named `__session`, which is why the session cookie has that name.
5. A budget alert (Billing → Budgets & alerts) tells you if costs ever move; it doesn't stop them, `--max-instances` does.

| Env var | |
|---|---|
| `SECRET` | required, long random string |
| `GOOGLE_CLIENT_ID` | OAuth web client ID |
| `CONTACT_EMAIL`, `OPERATOR_NAME` | shown on `/privacy` and `/terms` (review both texts before launch) |
| `FIRESTORE_DATABASE` | optional named database, only if you must share a project |

The Cloud Run service account needs the **Cloud Datastore User** role (the default compute account has it).
Firestore reads stay small: totals, streaks and today's results live on each user's document, so a page costs
about one read per connection, whatever the history.
