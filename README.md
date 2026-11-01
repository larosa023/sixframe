# Sixframe

**▶ Play: [sixframe.netlify.app](https://sixframe.netlify.app/)**

Daily guessing game: name the **movie**, **TV show**, or **video game** from up to six frames. Each wrong guess or skip reveals the next frame. New puzzles drop every night at **12:00 AM Eastern**, and the last **101 days** stay playable in the archive.

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
- Titles live in `tools/lists/` (movies from IMDb's "1000 Greatest Films", shows from listchallenges' "Top 1000 TV Series", games from playthatgame.co.uk filtered to Steam games with 6+ clean gameplay screenshots). Edit a list, then run `python3 tools/build-puzzles.py` to regenerate `data/puzzles.json`.
- Gameplay (modelled on guessthe.game / guessthemovie.name): 6 guesses, Skip reveals the next frame, and each miss unlocks one hint (movies: genre → year → director → co-stars → lead actor; shows: genre → first aired → network → creator → stars; games: genre → year → Metacritic → publisher → developer). A guess from the same franchise scores 🟨.
- Difficulty: every frame was hand-picked and ordered from hardest (frame 1) to easiest (frame 6).

## Frames: real shots only

Every frame is a real image from the movie, episode or game. No posters, key art, promo shots or logos. They were hand-picked and are stored in `data/stills.json`:

- **movies**: TMDB image paths of real film frames, keyed by IMDb id
- **shows**: TMDB episode stills (screenshots from actual episodes), keyed by puzzle id
- **games**: Steam store gameplay screenshots, stored as short keys and matched to the live Steam image at build time

On each Netlify build, `tools/fetch-frames.mjs` turns these into `data/frames.json` and looks up the hints. Set `TMDB` (your TMDB API key or read token) in **Netlify → Project configuration → Environment variables** for movie/show hints. Frames work without it.

If a game's store page drops a picked screenshot, the deploy log lists it under "issues" so it can be re-picked.

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
