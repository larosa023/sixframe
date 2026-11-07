// Build step: turn the hand-picked frames in data/stills.json into data/frames.json,
// and look up the per-puzzle hints. No art, posters or key art are ever used:
//   movies – hand-picked real film frames (TMDB image paths)
//   shows  – hand-picked real episode stills (TMDB image paths)
//   games  – hand-picked real gameplay screenshots (Steam store), matched by a short key
//
// Env var (Netlify → Project configuration → Environment variables):
//   TMDB  – TMDB API key or read token. Only needed for movie/show *hints*;
//           frames work without it.

import { readFile, writeFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const data = JSON.parse(await readFile(new URL("data/puzzles.json", root), "utf8"));
const stills = JSON.parse(await readFile(new URL("data/stills.json", root), "utf8"));
const IMG = "https://image.tmdb.org/t/p/w1280";
const out = { movies: {}, shows: {}, games: {} };
const problems = [];

// Accept TMDB, TMDB_KEY or TMDB_TOKEN; either the short API key or the long read token works.
const tmdbSecret = (process.env.TMDB_TOKEN || process.env.TMDB_KEY || process.env.TMDB || "").trim();
const TMDB_TOKEN = tmdbSecret.startsWith("eyJ") ? tmdbSecret : "";
const TMDB_KEY = TMDB_TOKEN ? "" : tmdbSecret;

const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const idOf = (p) => p.id || slug(p.answer);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, headers = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 || res.status === 403) { await sleep(1500 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url.replace(/(api_key)=[^&]+/, "$1=…")}`);
    return res.json();
  }
  throw new Error(`rate limited: ${url}`);
}

// Hints unlock one per miss, hardest first. Empty values are dropped.
const hintRows = (rows) => rows.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "").slice(0, 5);
const names = (list, n) => (list || []).slice(0, n).map((x) => x.name || x.description || x).filter(Boolean).join(", ");

/* ---------------- TMDB hints (movies + shows) ---------------- */
function tmdb(path, params = {}) {
  const q = new URLSearchParams(params);
  const headers = { accept: "application/json" };
  if (TMDB_TOKEN) headers.Authorization = `Bearer ${TMDB_TOKEN}`;
  else q.set("api_key", TMDB_KEY);
  return getJSON(`https://api.themoviedb.org/3${path}?${q}`, headers);
}

async function movieHints(p) {
  const f = await tmdb(`/find/${p.imdb}`, { external_source: "imdb_id" });
  const hit = f.movie_results[0];
  if (!hit) throw new Error("not found on TMDB");
  const info = await tmdb(`/movie/${hit.id}`, { append_to_response: "credits" });
  const cast = info.credits?.cast || [];
  const directors = (info.credits?.crew || []).filter((c) => c.job === "Director");
  return {
    hints: hintRows([
      ["Genre", names(info.genres, 2)],
      ["Released", p.year || (info.release_date || "").slice(0, 4)],
      ["Director", names(directors, 2)],
      ["Also starring", names(cast.slice(1), 2)],
      ["Lead actor", cast[0]?.name],
    ]),
    series: info.belongs_to_collection?.name,
  };
}

async function showHints(p, tmdbId) {
  const show = await tmdb(`/tv/${tmdbId}`, { append_to_response: "aggregate_credits" });
  const cast = [...(show.aggregate_credits?.cast || [])].sort((a, b) => (b.total_episode_count || 0) - (a.total_episode_count || 0));
  return {
    hints: hintRows([
      ["Genre", names(show.genres, 2)],
      ["First aired", p.year || (show.first_air_date || "").slice(0, 4)],
      ["Network", names(show.networks, 1)],
      ["Created by", names(show.created_by, 2)],
      ["Starring", names(cast, 2)],
    ]),
  };
}

/* ---------------- Steam (games, no key needed) ---------------- */
const steamApi = (params) =>
  getJSON(`https://store.steampowered.com/api/appdetails?${new URLSearchParams({ l: "english", cc: "US", ...params })}`);

async function steamDetails(appid) {
  await sleep(400); // stay under Steam's rate limit
  const r = await steamApi({ appids: String(appid) });
  const entry = r[appid];
  return entry && entry.success ? entry.data : null;
}

// Screenshot URLs end in .../ss_<40 hex>.1920x1080.jpg or .../<number>.1920x1080.jpg
function shotKey(url) {
  const m = url.match(/\/(?:ss_)?([a-f0-9]{40}|\d+)\.1920x1080\.jpg/);
  if (!m) return null;
  return /^\d+$/.test(m[1]) && m[1].length <= 12 ? String(parseInt(m[1], 10)) : m[1];
}

async function gameEntry(p, pick) {
  const details = [];
  for (const app of pick.apps) details.push(await steamDetails(app));
  const main = details[0];
  if (!main) throw new Error(`Steam app ${pick.apps[0]} unavailable`);
  const pool = details.flatMap((d) => (d?.screenshots || []).map((s) => s.path_full.split("?")[0]));
  const frames = [];
  for (const key of pick.keys) {
    // Short all-digit keys are Steam's numeric screenshot ids; longer keys are hash prefixes.
    const numericId = /^\d+$/.test(key) && key.length < 8;
    const url = pool.find((u) => { const k = shotKey(u); return k && (numericId ? k === key : k.startsWith(key)); });
    if (url) frames.push(url); else problems.push(`games: ${p.answer} – picked screenshot ${key} no longer on Steam`);
  }
  const hints = hintRows([
    ["Genre", names((main.genres || []).filter((g) => !/free to play|early access|indie/i.test(g.description)), 2)],
    ["Released", p.year || (main.release_date?.date || "").slice(-4)],
    ["Metacritic", main.metacritic?.score],
    ["Publisher", names(main.publishers, 1)],
    ["Developer", names(main.developers, 1)],
  ]);
  return { frames, hints };
}

/* ---------------- Run ---------------- */
const haveTmdb = Boolean(TMDB_TOKEN || TMDB_KEY);
if (!haveTmdb) console.log("⚠ TMDB not set — movie/show frames still work, but their hints are skipped");

for (const p of data.movies.puzzles) {
  const picked = stills.movies[p.imdb];
  if (!picked) { problems.push(`movies: ${p.answer} has no hand-picked frames`); continue; }
  const entry = { frames: picked.map((f) => IMG + f), link: `https://www.imdb.com/title/${p.imdb}/` };
  if (haveTmdb) {
    try { Object.assign(entry, await movieHints(p)); }
    catch (e) { problems.push(`movies: ${p.answer} hints – ${e.message}`); }
  }
  out.movies[idOf(p)] = entry;
  console.log(`✓ movie  ${p.answer}${entry.hints ? "" : " (no hints)"}`);
}

for (const p of data.shows.puzzles) {
  const picked = stills.shows[idOf(p)];
  if (!picked) { problems.push(`shows: ${p.answer} has no hand-picked frames`); continue; }
  const entry = { frames: picked.frames.map((f) => IMG + f), link: `https://www.themoviedb.org/tv/${picked.tmdb}` };
  if (haveTmdb) {
    try { Object.assign(entry, await showHints(p, picked.tmdb)); }
    catch (e) { problems.push(`shows: ${p.answer} hints – ${e.message}`); }
  }
  out.shows[idOf(p)] = entry;
  console.log(`✓ show   ${p.answer}${entry.hints ? "" : " (no hints)"}`);
}

for (const p of data.games.puzzles) {
  const picked = stills.games[idOf(p)];
  if (!picked) { problems.push(`games: ${p.answer} has no hand-picked frames`); continue; }
  try {
    const entry = { ...(await gameEntry(p, picked)), link: `https://store.steampowered.com/app/${picked.apps[0]}/` };
    out.games[idOf(p)] = entry;
    console.log(`✓ game   ${p.answer} (${entry.frames.length}/6)`);
  } catch (e) {
    problems.push(`games: ${p.answer} – ${e.message}`);
    console.log(`✗ game   ${p.answer} – ${e.message}`);
  }
}

await writeFile(new URL("data/frames.json", root), JSON.stringify(out));
console.log(`\nWrote data/frames.json`);
if (problems.length) console.log(`\n${problems.length} issue(s):\n- ${problems.join("\n- ")}`);
