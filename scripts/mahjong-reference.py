"""Development-only oracle. Python >=3.10; pip install -r scripts/mahjong-reference-requirements.txt."""
import argparse
import importlib.metadata
import json
from pathlib import Path
import random
import re

from mahjong.shanten import Shanten

VERSION = "1.4.0"
TILES = [str(i % 9 + 1) + "mps"[i // 9] if i < 27 else str(i - 26) + "z" for i in range(34)]
ROOT = Path(__file__).resolve().parents[1]


def expand(text):
    return [n + suit for numbers, suit in re.findall(r"(\d+)([mpsz])", text) for n in numbers]


def counts(tiles):
    result = [0] * 34
    for tile in tiles:
        result[TILES.index("5" + tile[1] if tile[0] == "0" else tile)] += 1
    return result


def evaluate(case):
    c = counts(case["hand"])
    exposed = counts([t for meld in case["melds"] for t in meld])
    opened = bool(case["melds"])
    legal = [i for i in range(34) if case["playerCount"] == 4 or i == 0 or i >= 8]

    def forms(c):
        s = Shanten()
        return {"regular": s.calculate_shanten_for_regular_hand(c),
                "chiitoitsu": None if opened else s.calculate_shanten_for_chiitoitsu_hand(c),
                "kokushi": None if opened else s.calculate_shanten_for_kokushi_hand(c)}

    def value(c):
        base = min(x for x in forms(c).values() if x is not None)
        # Explicit project policy: tiles locked in own melds cannot be drawn.
        # The reference infers meld count from concealed length, not their tile identities.
        if base == 0:
            def wait(c):
                for i in legal:
                    if c[i] + exposed[i] < 4:
                        c[i] += 1
                        win = min(x for x in forms(c).values() if x is not None) == -1
                        c[i] -= 1
                        if win:
                            return True
                return False
            if sum(c) % 3 == 1:
                live = wait(c)
            else:
                live = False
                for i in legal:
                    if c[i]:
                        c[i] -= 1
                        live = wait(c)
                        c[i] += 1
                        if live:
                            break
            if not live:
                base = 1
        return base

    def entry(c):
        base, effective = value(c), []
        for i in legal:
            if c[i] + exposed[i] < 4:
                c[i] += 1
                improves = value(c) < base
                c[i] -= 1
                if improves:
                    effective.append({"tile": TILES[i], "unseenUpperBound": 4 - counts(case["hand"])[i] - exposed[i]})
        return {"shanten": base, "effectiveTiles": effective,
                "totalUnseenUpperBound": sum(t["unseenUpperBound"] for t in effective)}

    by_type = forms(c)
    # Apply the project own-meld ownership policy to ordinary tenpai as well.
    if by_type["regular"] == 0:
        def regular_wait(c):
            for i in legal:
                if c[i] + exposed[i] < 4:
                    c[i] += 1
                    win = Shanten().calculate_shanten_for_regular_hand(c) == -1
                    c[i] -= 1
                    if win:
                        return True
            return False
        if sum(c) % 3 == 1:
            live = regular_wait(c)
        else:
            live = False
            for i in legal:
                if c[i]:
                    c[i] -= 1
                    live = regular_wait(c)
                    c[i] += 1
                    if live:
                        break
        if not live:
            by_type["regular"] = 1
    result = {"byType": by_type, "shanten": value(c), "current": None, "candidates": []}
    if len(case["hand"]) % 3 == 1:
        result["current"] = entry(c)
    else:
        for tile in dict.fromkeys(case["hand"]):
            i = TILES.index("5" + tile[1] if tile[0] == "0" else tile)
            c[i] -= 1
            result["candidates"].append({"tile": tile, **entry(c)})
            c[i] += 1
    return result


def generate(samples):
    named = [
        ("ordinary-wait", "123m123p123s111z2z", []),
        ("ordinary-win", "123m123p123s111z22z", []),
        ("seven-pairs", "1122m3344p5566s7z", []),
        ("seven-pairs-win", "1122m3344p5566s77z", []),
        ("unique-kind-correction", "1111m2222p3333s4z", []),
        ("orphans", "19m19p19s1234567z", []),
        ("orphans-win", "119m19p19s1234567z", []),
        ("red-five", "123m123p123s055s22z", []),
        ("own-four-dead-wait", "1111m222p333s444z", []),
        ("meld-locked-wait", "1m222p333s444z", ["111m"]),
        ("kan", "123p123s111z2z", ["1111m"]),
        ("four-melds", "2z", ["123m", "123p", "123s", "111z"]),
    ]
    cases = [{"id": name, "playerCount": 4, "hand": expand(hand), "melds": [expand(m) for m in melds]} for name, hand, melds in named]
    rng = random.Random(20261105)
    for player_count in [4, 3]:
        legal = [i for i in range(34) if player_count == 4 or i == 0 or i >= 8]
        for m in range(5):
            for size in [13 - 3 * m, 14 - 3 * m]:
                for sample in range(samples):
                    deck = [i for i in legal for _ in range(4)]
                    melds = []
                    while len(melds) < m:
                        i = rng.choice(legal)
                        group = [i] * rng.choice([3, 4])
                        if player_count == 4 and i < 27 and i % 9 < 7 and rng.randrange(2):
                            group = [i, i + 1, i + 2]
                        if all(deck.count(t) >= group.count(t) for t in group):
                            for t in group:
                                deck.remove(t)
                            melds.append([TILES[t] for t in group])
                    if sample % 2 == 0:
                        # Bias half the corpus toward complete/near-complete
                        # structures; uniform random hands rarely exercise waits.
                        available, ids = deck[:], []
                        for _ in range(4 - m):
                            groups = [[i] * 3 for i in legal if available.count(i) >= 3]
                            groups += [[i, i + 1, i + 2] for i in legal if i < 27 and i % 9 < 7
                                       and i + 1 in legal and i + 2 in legal
                                       and all(t in available for t in [i, i + 1, i + 2])]
                            group = rng.choice(groups)
                            for t in group:
                                available.remove(t)
                            ids.extend(group)
                        pair = rng.choice([i for i in legal if available.count(i) >= 2])
                        ids.extend([pair, pair])
                        if size % 3 == 1:
                            ids.pop(rng.randrange(len(ids)))
                        # Introduce up to two exchanges to cover adjacent shanten.
                        for _ in range(sample % 3):
                            i = rng.randrange(len(ids))
                            candidates = [t for t in legal if ids.count(t) + sum(meld.count(TILES[t]) for meld in melds) < 4]
                            ids[i] = rng.choice(candidates)
                        hand = [TILES[i] for i in ids]
                    else:
                        hand = [TILES[i] for i in rng.sample(deck, size)]
                    cases.append({"id": f"seed-{player_count}-{m}-{size}-{sample}", "playerCount": player_count, "hand": hand, "melds": melds})
    for case in cases:
        case["expected"] = evaluate(case)
        c, s = counts(case["hand"]), Shanten()
        case["referenceRaw"] = {"regular": s.calculate_shanten_for_regular_hand(c),
                                "chiitoitsu": None if case["melds"] else s.calculate_shanten_for_chiitoitsu_hand(c),
                                "kokushi": None if case["melds"] else s.calculate_shanten_for_kokushi_hand(c)}
    return {"oracle": "MahjongRepository/mahjong", "version": VERSION, "seed": 20261105,
            "policy": "riichi shape; closed specials only; red=5; sanma excludes 2-8m; own-meld copies constrain waits; no yaku/scoring oracle", "cases": cases}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=50)
    parser.add_argument("--out", type=Path, default=ROOT / "tests/fixtures/mahjong-reference.json")
    args = parser.parse_args()
    assert importlib.metadata.version("mahjong") == VERSION, "Reference version must be pinned"
    data = generate(args.samples)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Generated {len(data['cases'])} cases: {args.out}")
