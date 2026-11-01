#!/usr/bin/env python3
"""Rebuild data/puzzles.json from tools/lists/*.txt.

Edit a list, then run:  python3 tools/build-puzzles.py
Order is shuffled once with a fixed seed so each day mixes eras and genres.
"""
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
START = "2026-07-24"

DECOYS = {
    "movies": ["King Kong", "The Terminator", "The Lord of the Rings: The Fellowship of the Ring", "Kill Bill: Vol. 1",
               "The Silence of the Lambs", "The Color of Money", "This Is England", "It's a Wonderful Life",
               "Children of Men", "In the Name of the Father", "American History X", "12 Monkeys",
               "Dog Day Afternoon", "The Untouchables", "Close Encounters of the Third Kind",
               "The Good, the Bad and the Ugly", "Glengarry Glen Ross", "The Wolf of Wall Street",
               "Road to Perdition", "Up", "Natural Born Killers", "Out of Sight", "The Bourne Identity",
               "An American Werewolf in London", "United 93", "Full Metal Jacket", "The Deer Hunter",
               "Desperado", "Little Miss Sunshine", "Carlito's Way", "Casino Royale", "Dirty Harry", "Gremlins",
               "Butch Cassidy and the Sundance Kid", "Ocean's Eleven", "The Lord of the Rings: The Two Towers",
               "Star Wars", "Titanic", "Avatar", "Interstellar"],
    "shows": ["Peep Show", "The Bridge", "Neon Genesis Evangelion", "Justice League", "The Knick",
              "Agatha Christie's Poirot", "Samurai Champloo", "The Venture Bros.", "Young Justice",
              "I'm Alan Partridge", "Ghost in the Shell: Stand Alone Complex", "Rurouni Kenshin", "Monster",
              "Jeeves and Wooster", "Yu Yu Hakusho", "Mushi-Shi", "Endeavour", "Lost", "Prison Break", "Fringe",
              "Person of Interest", "Jessica Jones", "Silicon Valley", "Outlander", "Boston Legal", "Red Dwarf",
              "Trailer Park Boys", "Utopia", "Stranger Things", "Succession", "The Bear", "Severance",
              "The Last of Us", "The Mandalorian", "Squid Game", "Ted Lasso", "Arcane", "The Crown", "The Boys"],
    "games": ["Tetris", "The Legend of Zelda: Ocarina of Time", "Super Mario 64", "World of Warcraft",
              "Super Mario World", "Chrono Trigger", "The Legend of Zelda: A Link to the Past", "GoldenEye 007",
              "Minecraft", "Street Fighter II", "Super Metroid", "Super Mario Bros.", "Shadow of the Colossus",
              "Super Mario Bros. 3", "Uncharted 2: Among Thieves", "Grand Theft Auto III", "Metroid Prime",
              "StarCraft", "Castlevania: Symphony of the Night", "The Legend of Zelda: Breath of the Wild",
              "Pokémon Red and Blue", "Super Mario Kart", "Super Mario Galaxy", "The Legend of Zelda: The Wind Waker",
              "Grand Theft Auto: San Andreas", "Diablo II", "Super Smash Bros. Melee", "Pac-Man", "Ico",
              "Grand Theft Auto: Vice City", "The Sims", "Bloodborne", "Tomb Raider", "Sonic the Hedgehog",
              "Halo 3", "Super Mario Odyssey", "Rocket League", "Gears of War", "Fallout 4", "Kingdom Hearts",
              "Hotline Miami", "Dishonored 2", "Cuphead", "Hollow Knight", "Elden Ring", "Cyberpunk 2077",
              "Baldur's Gate 3", "Hades", "Sekiro: Shadows Die Twice", "Dark Souls III"],
}


def read(cat):
    rows = []
    for line in (ROOT / "tools" / "lists" / f"{cat}.txt").read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        f = line.split("|")
        e = {"answer": f[0], "year": int(f[1])}
        if cat == "movies":
            e["imdb"] = f[2]
            alias = f[3] if len(f) > 3 else ""
        else:
            alias = f[2] if len(f) > 2 else ""
        if alias:
            e["aliases"] = alias.split(";")
        if cat == "games":
            e["steam"] = int(f[3])
            if len(f) > 4 and f[4]:
                e["id"] = f[4]
        rows.append(e)
    return rows


data = {"start": START, "ext": "jpg"}
for cat in ("movies", "shows", "games"):
    rows = read(cat)
    keys = [r.get("id") or r["answer"] for r in rows]
    assert len(keys) == len(set(keys)), f"{cat}: duplicate titles need an 'id'"
    random.Random(f"sixframe-{cat}").shuffle(rows)
    answers = {r["answer"].lower() for r in rows}
    data[cat] = {"pool": [t for t in DECOYS[cat] if t.lower() not in answers], "puzzles": rows}
    print(f"{cat}: {len(rows)} puzzles | {START}: {rows[0]['answer']} | last: {rows[-1]['answer']}")

(ROOT / "data" / "puzzles.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
