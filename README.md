# Grid Games

Daily logic puzzles in a social-feed layout: **Queens, Tango, Zip, Mini Sudoku**.
Same puzzle for everyone each day (seeded by date), every puzzle has a unique solution.

- Run: `python3 -m http.server` then open http://localhost:8000 (ES modules need a server; GitHub Pages works too).
- Test: `node test.mjs`

Social: solve → **Share** copies `Queens #1009 | 1:23 | Name`. Paste friends' shares into
"Add a connection's result" to build today's leaderboard. Streaks and results live in localStorage.

## Deploy (Google Cloud Run)

```bash
gcloud run deploy grid-games --source . --region europe-west1 --port 80 --allow-unauthenticated
```
