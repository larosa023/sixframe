// Build step: resolve 6 frames for every puzzle and write data/frames.json.
// Movies & shows come from TMDB, games from RAWG. Images are linked, not copied.
//
// Needs env vars (set them in Netlify → Project configuration → Environment variables):
//   TMDB_TOKEN  – TMDB "API Read Access Token" (or TMDB_KEY – the shorter v3 API key)
//   RAWG_KEY    – RAWG API key
// Missing keys never fail the build; those puzzles just keep their placeholders.
//
// Per-puzzle overrides in data/puzzles.json:
//   "tmdb": 603        exact TMDB id if the title search picks the wrong thing
//   "rawg": "elden-ring"   exact RAWG id or slug
//   "frames": [...]    hand-picked image paths/URLs (skips lookup entirely)

import { readFile, writeFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const data = JSON.parse(await readFile(new URL("data/puzzles.json", root), "utf8"));
const { TMDB_TOKEN, TMDB_KEY, RAWG_KEY } = process.env;
const IMG = "https://image.tmdb.org/t/p/w1280";
const out = { movies: {}, shows: {}, games: {} };
const problems = [];

const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const norm = (s) => slug(s).replace(/^(the|a|an)-/, "");

async function getJSON(url, headers = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url.replace(/(key|api_key)=[^&]+/, "$1=…")}`);
    return res.json();
  }
  throw new Error(`rate limited: ${url}`);
}

// Pick 6 images, hardest first: least-popular stills early, the most iconic one last.
function pickSix(urls) {
  const uniq = [...new Set(urls)].filter(Boolean);
  if (uniq.length <= 6) return uniq;
  const picks = [];
  for (let i = 0; i < 6; i++) picks.push(uniq[Math.round((i * (uniq.length - 1)) / 5)]);
  return [...new Set(picks)];
}

/* ---------------- TMDB (movies + shows) ---------------- */
function tmdb(path, params = {}) {
  const q = new URLSearchParams(params);
  const headers = { accept: "application/json" };
  if (TMDB_TOKEN) headers.Authorization = `Bearer ${TMDB_TOKEN}`;
  else q.set("api_key", TMDB_KEY);
  return getJSON(`https://api.themoviedb.org/3${path}?${q}`, headers);
}

async function tmdbFind(kind, p) {
  if (p.tmdb) return p.tmdb;
  const yearParam = kind === "movie" ? "primary_release_year" : "first_air_date_year";
  let r = await tmdb(`/search/${kind}`, { query: p.answer, ...(p.year ? { [yearParam]: p.year } : {}) });
  if (!r.results.length && p.year) r = await tmdb(`/search/${kind}`, { query: p.answer });
  if (!r.results.length) throw new Error("no TMDB match");
  const exact = r.results.find((x) => norm(x.title || x.name) === norm(p.answer));
  return (exact || r.results[0]).id;
}

// Text-free backdrops (no title cards), least-voted first.
const cleanBackdrops = (imgs) => imgs.backdrops
  .filter((b) => b.iso_639_1 === null || b.iso_639_1 === "xx")
  .sort((a, b) => a.vote_count - b.vote_count || a.vote_average - b.vote_average)
  .map((b) => IMG + b.file_path);

async function movieFrames(p) {
  const id = await tmdbFind("movie", p);
  const imgs = await tmdb(`/movie/${id}/images`);
  let urls = cleanBackdrops(imgs);
  if (urls.length < 6) urls = urls.concat(imgs.backdrops.map((b) => IMG + b.file_path));
  return { id, frames: pickSix(urls) };
}

async function showFrames(p) {
  const id = await tmdbFind("tv", p);
  const show = await tmdb(`/tv/${id}`);
  // Early frames: episode stills from across the run (harder). Late frames: show backdrops (easier).
  const seasons = show.seasons.filter((s) => s.season_number > 0 && s.episode_count > 0);
  const stills = [];
  for (const s of seasons.slice(0, 3)) {
    try {
      const season = await tmdb(`/tv/${id}/season/${s.season_number}`);
      for (const ep of season.episodes) if (ep.still_path) stills.push(IMG + ep.still_path);
    } catch { /* some seasons have no details */ }
  }
  const backdrops = cleanBackdrops(await tmdb(`/tv/${id}/images`));
  const early = pickSix(stills).slice(0, 4);
  const late = backdrops.slice(-Math.max(2, 6 - early.length));
  let frames = [...new Set([...early, ...late])];
  if (frames.length < 6) frames = pickSix([...stills, ...backdrops]);
  return { id, frames: frames.slice(0, 6) };
}

/* ---------------- RAWG (games) ---------------- */
const rawg = (path, params = {}) =>
  getJSON(`https://api.rawg.io/api${path}?${new URLSearchParams({ key: RAWG_KEY, ...params })}`);

async function gameFrames(p) {
  let id = p.rawg;
  if (!id) {
    const r = await rawg("/games", { search: p.answer, search_precise: "true", page_size: "10" });
    if (!r.results.length) throw new Error("no RAWG match");
    const year = (g) => (g.released ? +g.released.slice(0, 4) : 0);
    const best = r.results.find((g) => norm(g.name) === norm(p.answer) && (!p.year || Math.abs(year(g) - p.year) <= 1))
      || r.results.find((g) => norm(g.name) === norm(p.answer))
      || r.results.find((g) => !p.year || Math.abs(year(g) - p.year) <= 1)
      || r.results[0];
    id = best.slug;
  }
  const [shots, game] = await Promise.all([rawg(`/games/${id}/screenshots`, { page_size: "20" }), rawg(`/games/${id}`)]);
  // Screenshots first (harder), then the main art (easiest).
  const urls = shots.results.filter((s) => !s.is_deleted).map((s) => s.image);
  const frames = pickSix(urls).slice(0, game.background_image ? 5 : 6);
  if (game.background_image && !frames.includes(game.background_image)) frames.push(game.background_image);
  return { id, frames: frames.slice(0, 6) };
}

/* ---------------- Run ---------------- */
const jobs = [
  ["movies", movieFrames, TMDB_TOKEN || TMDB_KEY, "TMDB_TOKEN"],
  ["shows", showFrames, TMDB_TOKEN || TMDB_KEY, "TMDB_TOKEN"],
  ["games", gameFrames, RAWG_KEY, "RAWG_KEY"],
];

for (const [cat, fn, haveKey, keyName] of jobs) {
  if (!haveKey) { console.log(`⚠ ${keyName} not set — skipping ${cat}`); continue; }
  for (const p of data[cat].puzzles) {
    if (p.frames) continue;
    try {
      const { id, frames } = await fn(p);
      if (frames.length < 6) problems.push(`${cat}: ${p.answer} only has ${frames.length} images`);
      out[cat][p.id || slug(p.answer)] = frames;
      console.log(`✓ ${cat.padEnd(6)} ${p.answer} → ${id} (${frames.length})`);
    } catch (e) {
      problems.push(`${cat}: ${p.answer} – ${e.message}`);
      console.log(`✗ ${cat.padEnd(6)} ${p.answer} – ${e.message}`);
    }
  }
}

await writeFile(new URL("data/frames.json", root), JSON.stringify(out));
console.log(`\nWrote data/frames.json`);
if (problems.length) console.log(`\n${problems.length} issue(s):\n- ${problems.join("\n- ")}`);
