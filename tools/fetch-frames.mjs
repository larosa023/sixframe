// Build step: resolve 6 frames for every puzzle and write data/frames.json.
// Movies & shows come from TMDB, games from the Steam store. Images are linked, not copied.
//
// Needs env vars (set them in Netlify → Project configuration → Environment variables):
//   TMDB_TOKEN  – TMDB "API Read Access Token" (or TMDB_KEY – the shorter v3 API key)
// Games need no key. A missing TMDB key never fails the build; those puzzles keep placeholders.
//
// Per-puzzle overrides in data/puzzles.json:
//   "tmdb": 603        exact TMDB id if the title search picks the wrong thing
//   "steam": 1245620   exact Steam app id
//   "frames": [...]    hand-picked image paths/URLs (skips lookup entirely)

import { readFile, writeFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const data = JSON.parse(await readFile(new URL("data/puzzles.json", root), "utf8"));
// Accept TMDB, TMDB_KEY or TMDB_TOKEN; either the short API key or the long read token works.
const tmdbSecret = (process.env.TMDB_TOKEN || process.env.TMDB_KEY || process.env.TMDB || "").trim();
const TMDB_TOKEN = tmdbSecret.startsWith("eyJ") ? tmdbSecret : "";
const TMDB_KEY = TMDB_TOKEN ? "" : tmdbSecret;
const IMG = "https://image.tmdb.org/t/p/w1280";
const out = { movies: {}, shows: {}, games: {} };
const problems = [];

const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const norm = (s) => slug(s).replace(/^(the|a|an)-/, "");

async function getJSON(url, headers = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 || res.status === 403) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
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
  if (p.imdb) {
    // Exact match by IMDb id (no guessing between remakes or same-name titles).
    const f = await tmdb(`/find/${p.imdb}`, { external_source: "imdb_id" });
    const hit = (kind === "movie" ? f.movie_results : f.tv_results)[0];
    if (hit) return hit.id;
  }
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

// Hints are revealed one per miss, hardest first. Empty values are dropped.
const hintRows = (rows) => rows.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "").slice(0, 5);
const names = (list, n) => (list || []).slice(0, n).map((x) => x.name || x.description || x).filter(Boolean).join(", ");

async function movieFrames(p) {
  const id = await tmdbFind("movie", p);
  const [imgs, info] = await Promise.all([
    tmdb(`/movie/${id}/images`),
    tmdb(`/movie/${id}`, { append_to_response: "credits" }),
  ]);
  let urls = cleanBackdrops(imgs);
  if (urls.length < 6) urls = urls.concat(imgs.backdrops.map((b) => IMG + b.file_path));
  const cast = info.credits?.cast || [];
  const directors = (info.credits?.crew || []).filter((c) => c.job === "Director");
  const hints = hintRows([
    ["Genre", names(info.genres, 2)],
    ["Released", p.year || (info.release_date || "").slice(0, 4)],
    ["Director", names(directors, 2)],
    ["Also starring", names(cast.slice(1), 2)],
    ["Lead actor", cast[0]?.name],
  ]);
  return { id, frames: pickSix(urls), hints, series: info.belongs_to_collection?.name };
}

async function showFrames(p) {
  const id = await tmdbFind("tv", p);
  const show = await tmdb(`/tv/${id}`, { append_to_response: "aggregate_credits" });
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
  const cast = [...(show.aggregate_credits?.cast || [])].sort((a, b) => (b.total_episode_count || 0) - (a.total_episode_count || 0));
  const hints = hintRows([
    ["Genre", names(show.genres, 2)],
    ["First aired", p.year || (show.first_air_date || "").slice(0, 4)],
    ["Network", names(show.networks, 1)],
    ["Created by", names(show.created_by, 2)],
    ["Starring", names(cast, 2)],
  ]);
  return { id, frames: frames.slice(0, 6), hints };
}

/* ---------------- Steam (games, no key needed) ---------------- */
const steamApi = (path, params) =>
  getJSON(`https://store.steampowered.com/api/${path}?${new URLSearchParams({ l: "english", cc: "US", ...params })}`);

async function steamDetails(appid) {
  await new Promise((r) => setTimeout(r, 400)); // stay under Steam's rate limit
  const r = await steamApi("appdetails", { appids: String(appid) });
  const entry = r[appid];
  return entry && entry.success ? entry.data : null;
}

async function gameFrames(p) {
  let data = p.steam ? await steamDetails(p.steam) : null;
  // A pinned id that disappeared or points at a different game → fall back to search.
  if (!data || (!norm(data.name).includes(norm(p.answer).split("-")[0]))) {
    const r = await steamApi("storesearch/", { term: p.answer });
    const items = r.items || [];
    if (!items.length) throw new Error("no Steam match");
    const best = items.find((g) => norm(g.name) === norm(p.answer)) || items[0];
    data = await steamDetails(best.id);
    if (!data) throw new Error("Steam details unavailable");
  }
  // Developers list their most iconic screenshot first, so reverse for hardest → easiest.
  const shots = (data.screenshots || []).map((s) => s.path_full);
  const frames = pickSix(shots).reverse();
  // Some store pages only have 5 screenshots; top up with the store backdrop art.
  for (const extra of [data.background_raw, data.background]) {
    if (frames.length < 6 && extra && !frames.includes(extra)) frames.push(extra);
  }
  const hints = hintRows([
    ["Genre", names((data.genres || []).filter((g) => !/free to play|early access|indie/i.test(g.description)), 2)],
    ["Released", p.year || (data.release_date?.date || "").slice(-4)],
    ["Metacritic", data.metacritic?.score],
    ["Publisher", names(data.publishers, 1)],
    ["Developer", names(data.developers, 1)],
  ]);
  return { id: `${data.steam_appid} ${data.name}`, frames, hints };
}

/* ---------------- Run ---------------- */
const jobs = [
  ["movies", movieFrames, TMDB_TOKEN || TMDB_KEY, "TMDB"],
  ["shows", showFrames, TMDB_TOKEN || TMDB_KEY, "TMDB"],
  ["games", gameFrames, true, ""],
];

for (const [cat, fn, haveKey, keyName] of jobs) {
  if (!haveKey) { console.log(`⚠ ${keyName} not set — skipping ${cat}`); continue; }
  for (const p of data[cat].puzzles) {
    if (p.frames) continue;
    try {
      const { id, frames, hints, series } = await fn(p);
      if (frames.length < 6) problems.push(`${cat}: ${p.answer} only has ${frames.length} images`);
      out[cat][p.id || slug(p.answer)] = { frames, hints, ...(series ? { series } : {}) };
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
