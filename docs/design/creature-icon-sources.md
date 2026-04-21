# Creature Icon Sources (Unity → Web)

Research output for replacing the current white-background creature PNGs in
`src/assets/creatures/` with transparent-background versions shipped in the
Unity `cult-tycoon` project.

Source of truth for naming: `src/data/CREATURE_MAPPING.md` and
`src/ui/creatureImages.ts`.

---

## Unity project path

`/Users/labetsky/conductor/workspaces/cult-unity/geneva/cult-tycoon/`

Sprite root for creature icons:

`Assets/2D/SpritesWithAlpha/Merge/creatures/Creature{1..8}/`

Each `Creature{N}/` folder stores per-level PNGs named
`{commonName}_{level}.png` (level 1..N). Common names match the entries in
`CREATURE_MAPPING.md`.

---

## Required creature set (current web prototype)

Directory: `/Users/labetsky/conductor/workspaces/CULT.MERGE/perth/src/assets/creatures/`

Total: **101 PNGs**, 210×210 px, 8-bit, `hasAlpha: no` (white background — the
thing we need to replace).

| Type | Name | Levels present | Files |
|---|---|---|---|
| Creature1 | Spider | 1–9 | `creature1_lvl1.png` … `creature1_lvl9.png` |
| Creature2 | Slime | 1–9 | `creature2_lvl1.png` … `creature2_lvl9.png` |
| Creature3 | Imp | 1–9 | `creature3_lvl1.png` … `creature3_lvl9.png` |
| Creature4 | Ghost | 1–9 | `creature4_lvl1.png` … `creature4_lvl9.png` |
| Creature5 | Mandragora | 1–5 | `creature5_lvl1.png` … `creature5_lvl5.png` |
| Creature6 | Pumpkin | 1–5 | `creature6_lvl1.png` … `creature6_lvl5.png` |
| Creature7 | Mole | 1–7 | `creature7_lvl1.png` … `creature7_lvl7.png` |
| Creature8 | FishPeople | 1–6 | `creature8_lvl1.png` … `creature8_lvl6.png` |
| Creature9 | Cats | 1–7 | `creature9_lvl1.png` … `creature9_lvl7.png` |
| Creature10 | Dogs | 1–7 | `creature10_lvl1.png` … `creature10_lvl7.png` |
| Creature11 | Chicken | 1–7 | `creature11_lvl1.png` … `creature11_lvl7.png` |
| Creature12 | Sheep | 1–7 | `creature12_lvl1.png` … `creature12_lvl7.png` |
| Creature13 | MonsterEye | 1–7 | `creature13_lvl1.png` … `creature13_lvl7.png` |
| Creature14 | Snakes | 1–7 | `creature14_lvl1.png` … `creature14_lvl7.png` |

Level counts match exactly between `creatureImages.ts` and the file system.

---

## Source locations in Unity

Unity ships per-level sprites (one PNG per level — no reuse of a base sprite
across levels). All sources verified 210×210 px, `hasAlpha: yes`, 8-bit.

Mapping web file → Unity file (template: substitute `L = 1..maxLevel`):

| Web file | Unity file |
|---|---|
| `creature1_lvl{L}.png` | `Assets/2D/SpritesWithAlpha/Merge/creatures/Creature1/spider_{L}.png` |
| `creature2_lvl{L}.png` | `Assets/2D/SpritesWithAlpha/Merge/creatures/Creature2/slime_{L}.png` |
| `creature3_lvl{L}.png` | `Assets/2D/SpritesWithAlpha/Merge/creatures/Creature3/imp_{L}.png` |
| `creature4_lvl{L}.png` | `Assets/2D/SpritesWithAlpha/Merge/creatures/Creature4/ghost_{L}.png` |
| `creature5_lvl{L}.png` | `Assets/2D/SpritesWithAlpha/Merge/creatures/Creature5/mandragora_{L}.png` |
| `creature6_lvl{L}.png` | `Assets/2D/SpritesWithAlpha/Merge/creatures/Creature6/pumpkin_{L}.png` |
| `creature7_lvl{L}.png` | `Assets/2D/SpritesWithAlpha/Merge/creatures/Creature7/mole_{L}.png` |
| `creature8_lvl{L}.png` | `Assets/2D/SpritesWithAlpha/Merge/creatures/Creature8/fishpeople_{L}.png` |
| `creature9_lvl{L}.png`  | **MISSING** (see Gaps) |
| `creature10_lvl{L}.png` | **MISSING** |
| `creature11_lvl{L}.png` | **MISSING** |
| `creature12_lvl{L}.png` | **MISSING** |
| `creature13_lvl{L}.png` | **MISSING** |
| `creature14_lvl{L}.png` | **MISSING** |

Per-creature Unity level counts vs web requirement:

| Creature | Unity levels | Web levels | Status |
|---|---|---|---|
| Creature1 (spider)      | 9 | 9 | ok |
| Creature2 (slime)       | 9 | 9 | ok |
| Creature3 (imp)         | 9 | 9 | ok |
| Creature4 (ghost)       | 9 | 9 | ok |
| Creature5 (mandragora)  | 5 | 5 | ok |
| Creature6 (pumpkin)     | 5 | 5 | ok |
| Creature7 (mole)        | 7 | 7 | ok |
| Creature8 (fishpeople)  | 6 | 6 | ok |
| Creature9 (cats)        | — | 7 | missing |
| Creature10 (dogs)       | — | 7 | missing |
| Creature11 (chicken)    | — | 7 | missing |
| Creature12 (sheep)      | — | 7 | missing |
| Creature13 (monster eye)| — | 7 | missing |
| Creature14 (snakes)     | — | 7 | missing |

**Coverage: 59 / 101 files replaceable from Unity (Creatures 1–8).**

---

## Transparency confirmation

Sampled via `sips -g hasAlpha -g pixelWidth -g pixelHeight -g bitsPerSample`:

- Unity `Creature1..8` sprites: **hasAlpha: yes**, 210×210, 8-bit. Verified on
  `spider_1`, `spider_5`, `slime_9`, `imp_2`, `ghost_7`, `mandragora_1`,
  `mandragora_3`, `pumpkin_5`, `mole_4`, `fishpeople_1`, `fishpeople_6`.
- Parent dir is literally named `SpritesWithAlpha`, and the sibling
  `SpritesNoAlpha/` dir is for UI backgrounds only (no creatures there).
- Current web `creature*_lvl*.png` files: **hasAlpha: no**, 210×210, 8-bit.
  Verified on `creature1_lvl1`, `creature5_lvl3`, `creature14_lvl7`.

Both sides already share the same 210×210 canvas, so drop-in replacement will
not affect layout — only the background will become transparent.

---

## Gaps

Unity `cult-tycoon` currently ships **Creatures 1–8 only** in
`Assets/2D/SpritesWithAlpha/Merge/creatures/`. The Unity data asset
`Assets/Settings/Game/3.20/Merge/3.20_Merge_CreaturesInfo.asset` also only
references `Creature1`..`Creature8` (64 entries: 9+9+9+9+5+5+7+6 + 1 = 59 levels,
grouped by 8 creature ids).

No sprites or sprite atlases for **Creature9 (Cats), Creature10 (Dogs),
Creature11 (Chicken), Creature12 (Sheep), Creature13 (MonsterEye),
Creature14 (Snakes)** were found anywhere under
`/Users/labetsky/conductor/workspaces/cult-unity/`. Searched for:

- Filenames matching `cat_*`, `dog_*`, `chicken_*`, `sheep_*`, `snake*`,
  `monster_eye*`, `monstereye*`
- Directories matching `Creature9`..`Creature14`
- Broader `*.png` in Unity `Assets/` tree

None found. These 42 web files (creatures 9–14, 7 levels each) must be sourced
elsewhere (new art) or remain as-is. Possible additional locations worth
asking the user about:

- Another Unity branch / feature branch not checked out locally
- A design Figma/Google Drive with "v2 creatures"
- The `algiers/FROM UNITY/screenshots/` dir (only has screenshots, not PNGs)

---

## Copy / extraction commands

Drop-in replacement script (Creatures 1–8 only). No cropping or format
conversion required — same dimensions, same bit depth, only alpha differs.

```bash
#!/usr/bin/env bash
set -euo pipefail

UNITY="/Users/labetsky/conductor/workspaces/cult-unity/geneva/cult-tycoon/Assets/2D/SpritesWithAlpha/Merge/creatures"
WEB="/Users/labetsky/conductor/workspaces/CULT.MERGE/perth/src/assets/creatures"

# Creature1 Spider (1..9)
for L in 1 2 3 4 5 6 7 8 9; do cp "$UNITY/Creature1/spider_${L}.png"      "$WEB/creature1_lvl${L}.png"; done
# Creature2 Slime (1..9)
for L in 1 2 3 4 5 6 7 8 9; do cp "$UNITY/Creature2/slime_${L}.png"       "$WEB/creature2_lvl${L}.png"; done
# Creature3 Imp (1..9)
for L in 1 2 3 4 5 6 7 8 9; do cp "$UNITY/Creature3/imp_${L}.png"         "$WEB/creature3_lvl${L}.png"; done
# Creature4 Ghost (1..9)
for L in 1 2 3 4 5 6 7 8 9; do cp "$UNITY/Creature4/ghost_${L}.png"       "$WEB/creature4_lvl${L}.png"; done
# Creature5 Mandragora (1..5)
for L in 1 2 3 4 5;         do cp "$UNITY/Creature5/mandragora_${L}.png"  "$WEB/creature5_lvl${L}.png"; done
# Creature6 Pumpkin (1..5)
for L in 1 2 3 4 5;         do cp "$UNITY/Creature6/pumpkin_${L}.png"     "$WEB/creature6_lvl${L}.png"; done
# Creature7 Mole (1..7)
for L in 1 2 3 4 5 6 7;     do cp "$UNITY/Creature7/mole_${L}.png"        "$WEB/creature7_lvl${L}.png"; done
# Creature8 FishPeople (1..6)
for L in 1 2 3 4 5 6;       do cp "$UNITY/Creature8/fishpeople_${L}.png"  "$WEB/creature8_lvl${L}.png"; done

echo "Done. Replaced 59 files. Creatures 9-14 left untouched (no Unity source)."
```

### Optional: sanity check after copy

```bash
# All replaced files should now show hasAlpha: yes
for f in /Users/labetsky/conductor/workspaces/CULT.MERGE/perth/src/assets/creatures/creature{1,2,3,4,5,6,7,8}_lvl*.png; do
  sips -g hasAlpha "$f" | tail -1
done | sort | uniq -c
# Expected: 59 lines of "  hasAlpha: yes"
```

### Note on git

Files live under `src/assets/creatures/` which is tracked; after `cp`, a
`git status` will show 59 modified PNGs. The filenames stay identical, so no
imports in `src/ui/creatureImages.ts` need to change.
