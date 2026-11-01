# Sixframe

Daily guessing game: name the **movie**, **TV show**, or **video game** from up to six frames. Each wrong guess or skip reveals the next frame. New puzzles drop every night at **12:00 AM Eastern**, and the last **100 days** stay playable in the archive.

Pure static site (HTML/CSS/JS) — no build step, no server, works on GitHub Pages.

## Publish on GitHub Pages

1. Create a repo named `sixframe` and push this folder to it.
2. Repo **Settings → Pages → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Your site will be at `https://<your-username>.github.io/sixframe/`.

```bash
git init && git add . && git commit -m "Sixframe"
git branch -M main
git remote add origin https://github.com/<your-username>/sixframe.git
git push -u origin main
```

Run locally: `python -m http.server` in this folder, then open http://localhost:8000.

## How the daily rotation works

- `data/puzzles.json` → `start` is puzzle **#1**. Every day after adds one.
- Day boundaries are computed in `America/New_York`, DST included, in every visitor's browser. The page counts down to midnight ET and swaps to the new puzzles live, no refresh needed.
- Puzzles rotate in list order. To lock a puzzle to a specific day, add `"date": "2026-12-25"` to it.
- 101 puzzles per category, starting 2026-07-24 (#1) through 2026-11-01 (#101), so the whole archive is playable from launch. After that the list loops, and each puzzle comes back only after it has dropped out of the archive.
- Titles live in `tools/lists/` (movies from IMDb's "1000 Greatest Films", shows from listchallenges' "Top 1000 TV Series", games from playthatgame.co.uk filtered to Steam). Edit a list, then run `python3 tools/build-puzzles.py` to regenerate `data/puzzles.json`.
- Difficulty: frames run from obscure to iconic, and frames 1–3 are zoomed into a detail (2.6×, 1.8×, 1.3×). Change `ZOOM` at the top of `app.js` to adjust.

## Automatic frames (Netlify)

On every Netlify build, `tools/fetch-frames.mjs` looks up each puzzle and links 6 images: TMDB stills for movies and shows, Steam store screenshots for games (no key needed). Set this in **Netlify → Project configuration → Environment variables**, then redeploy:

- `TMDB` – your TMDB API key or Read Access Token (themoviedb.org → Settings → API)

The deploy log lists every match. If a title resolves to the wrong thing, pin it with `"tmdb": <id>` or `"steam": <app id>` on that puzzle.

## Adding frames manually

Each puzzle loads 6 images from:

```
frames/<category>/<slug-of-answer>/1.jpg … 6.jpg
```

e.g. `The Matrix` → `frames/movies/the-matrix/1.jpg`. Frame 1 should be the hardest, frame 6 the easiest. Until images exist the game shows a placeholder, so the site is fully playable for testing.

Grab frames from a video file you own:

```bash
chmod +x tools/make-frames.sh
tools/make-frames.sh movies "The Matrix" ~/Videos/matrix.mkv
# or pick exact timestamps (hardest → easiest):
tools/make-frames.sh games "Elden Ring" gameplay.mp4 00:01:00 00:05:20 00:09:00 00:14:30 00:20:00 00:25:10
```

Keep images around 1280px wide JPG/WebP (≈100–200 KB) so the repo stays small. To use another extension set `"ext": "webp"` globally or per puzzle, or give a puzzle an explicit `"frames": [ ...6 paths or URLs... ]`.

## Puzzle format

```json
{ "answer": "Back to the Future", "year": 1985, "aliases": ["BTTF"] }
```

- `answer` – the title shown in autocomplete and on the reveal
- `aliases` – other accepted spellings (matching ignores case, punctuation, accents and a leading "The")
- `pool` (per category) – extra titles that appear in autocomplete as decoys so the answer list isn't obvious

## Player data

Progress, streaks and the guess distribution are stored in each player's browser (`localStorage`). Streaks count only puzzles solved on their own day; archive plays add to totals.

## Note on images

Movie, show and game frames are copyrighted by their owners. Use short, low-resolution stills, and remove any on request.
