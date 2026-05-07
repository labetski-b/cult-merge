# Line Upgrade Mechanic — Alternative Designs

Research brief for rethinking the "line upgrade" feature. Issue: applied upgrades make low-level creatures unobtainable from generators, breaking low-level tasks.

## 1. Current Mechanic — Verified

The user's description is **accurate**. Confirmed against code:

- **State**: `LineUpgradeState = { mergeCount, appliedUpgrades }` keyed per line (`src/domain/types.ts:201`).
- **Threshold check**: `isUpgradeAvailable` returns true when `mergeCount >= thresholds[appliedUpgrades]` (`src/domain/lineUpgrades.ts:40`). Defaults: `[30, 60, 120, 240, 480]`, `spawnCapLevel: 7` (`src/data/line_upgrades.json`).
- **Spawn shift (the "floor")**: `applyLineUpgradeToLevel` in `src/domain/generator.ts:69` does `Math.min(baseLevel + bonus, cap)`, where `bonus = appliedUpgrades`. This shifts *every* output of that line up by N, regardless of the output's own `level` field or its weighted chance. A Lv1 entry in `generators.json` becomes Lv(1+N) at spawn time.
- **Queued-charge bump**: `applyLineUpgradeAction` (`src/store/gameStore.ts:1721`) iterates `state.entities`, and for every generator entity, walks `charges` and bumps `level + 1` (clamped to cap) for charges whose `creatureType === line`. Sim engine mirrors this via `applyLineUpgrade` in `SimulationEngine.ts:250`.
- **`recordMerge`** (`src/domain/lineUpgrades.ts:29`) is called from the merge pipeline; any merge on the line increments its counter.

**Edge cases worth noting**:

- Generators carry **two lines** (e.g. Gen1 = `["Creature1", "Creature2"]`, see `src/data/generators.json`). Upgrading Creature1 does *not* affect Creature2's spawns on the same generator — the bonus is applied per-creatureType in `applyLineUpgradeToLevel`. Good; fine granularity exists.
- **Cap = 7** in defaults, but creatures go to Lv15. Upgrades can never push floor above 7. So "low level creatures disappear" is a real but bounded problem: floors 1..7.
- **No cost plumbing**: `costs: [null, null, null, null, null]` — currently the upgrade is free once the threshold is met.
- **Irreversible**: `applyLineUpgrade` only increments `appliedUpgrades`; no "downgrade" API.

## 2. Reference — How Similar Games Handle It

- **Merge Dragons / EverMerge**: generators produce a *fixed* distribution; progression comes from unlocking *new generators* or chests, not shifting a line's floor. Low-level items are always reachable.
- **Travel Town**: source items have a "refresh" timer; output distribution is authored per source-level and doesn't shift. "Power-up" boosters give temporary higher outputs but don't remove low tiers.
- **Merge Mansion**: generator "upgrades" widen the *top* of the output range (Lv1..Lv3 → Lv1..Lv4), leaving the bottom intact. Low tiers get rarer by dilution, not by truncation.
- **Idle ascension games (NGU, Realm Grinder)**: ascensions reset progress in exchange for persistent multipliers; players opt in. Not quite our mechanic, but the "opt-in stronger mode" pattern is relevant.

Takeaway: **floor-shifting is unusual**. Mainstream merge-idle games widen the range, add new sources, or pay a cost per spawn — they don't remove the bottom.

## 3. Alternative Designs

### (a) Probability distribution shift — "weighted ceiling"
**Core**: Upgrade adds higher-level entries to the weighted table but keeps (attenuated) low-level entries. RNG rolls a richer distribution.

**Spawns after upgrade**: Lv1 still possible, just rarer. E.g. from `Lv1:1.0` to `Lv1:0.5, Lv2:0.3, Lv3:0.2` at upgrade 1; `Lv1:0.2, Lv2:0.3, Lv3:0.3, Lv4:0.2` at upgrade 2.

**Vs floor shift**: Feels more organic; still lets late-game tasks asking Lv1 succeed. Cons: more tuning (two dimensions: chance × level); harder for players to read what an upgrade does.

**Tasks impact**: Solved — low-level tasks achievable, just slower.

**Implementation**: Replace `applyLineUpgradeToLevel` with a distribution-aware resolver. Either (1) author explicit per-upgrade output tables in `line_upgrades.json` (`outputsByUpgradeLevel`), or (2) keep a procedural "spread" that mixes `selected.level + k` for `k ∈ [0..bonus]` with decaying weights. Touch points: `generator.ts:rollGeneratorSpawn`, `lineUpgrades.ts`, schema in `schemas.ts`. Drop the queued-charge bump step, or soften it.

### (b) Dual-line / additive sub-pool
**Core**: Upgrade unlocks a *new* higher-tier output pool for the generator. Each roll picks base-pool vs upgraded-pool by a configured weight (e.g. 60/40).

**Spawns after upgrade**: Base pool preserved entirely at its original rates; upgraded pool adds Lv2/Lv3 outputs.

**Vs floor shift**: Preserves the feeling of "new content unlocked" — like a second source attached. Cons: generator output per charge doubles in variety; UI needs to surface both pools.

**Tasks impact**: Fully solved; base distribution untouched.

**Implementation**: Extend `GeneratorLevelConfig.outputs` into `{ basePool, upgradePools: [{ minAppliedUpgrades, pickWeight, outputs }] }`. `rollGeneratorSpawn` picks a pool first, then `weightedSelect` within. No level bumping. Largest config churn of the four options.

### (c) Per-generator tier toggle
**Core**: Upgrade grants the *option* of a higher tier. Each generator instance has a `spawnTier: 0..appliedUpgrades` toggle. Floor-shift logic is preserved but applied selectively.

**Spawns after upgrade**: If toggle at tier 0 → same as pre-upgrade. If at tier 2 → Lv3 floor.

**Vs floor shift**: Minimal mechanical change, maximum player control. Cons: adds a UI affordance per generator; risks decision fatigue ("what tier should I be running?"); novice players may never toggle.

**Tasks impact**: Solved iff player understands the toggle. Could auto-suggest tier when a low-tier task is active.

**Implementation**: Add `spawnTier: number` on `GeneratorEntity`. `applyLineUpgradeToLevel` uses `Math.min(generator.spawnTier, appliedUpgrades)` instead of `appliedUpgrades`. UI: tier selector on generator tap. Smallest change to core.

### (d) Cost-of-spawn ("pay more for better")
**Core**: Upgrade is purely an unlock; per-charge meat cost scales with desired spawn tier. Cheap charge → base distribution. Expensive charge → upgraded distribution.

**Spawns after upgrade**: Both remain available; cost is the gate.

**Vs floor shift**: Creates a resource sink (fits idle-merge economy). Cons: player must re-decide on every charge; pacing risk if meat is plentiful.

**Tasks impact**: Solved; low tier is literally the cheap default.

**Implementation**: Extend charge API to take a `tier` arg, multiply `chargeCost` by a factor from `line_upgrades.json`. Touch `canChargeGenerator`, charge flows in `gameStore.ts` and the sim strategy, and the spawn roll. Moderate complexity; feels economy-first.

### (e) Alternative — "Rarity boost" (non-floor reward)
**Core**: Upgrade keeps distribution identical but adds an occasional *bonus merge* on spawn (e.g. N% chance that a spawned creature auto-pairs with a neighbor one tier higher). Low tier never vanishes — the upgrade just accelerates climbing.

**Tasks impact**: Solved (distribution untouched).

**Pros**: Strong "progression feel" without touching the level field. Cons: introduces novel auto-merge behavior; harder to tune and test.

## 4. Recommendation

**Primary: (a) Probability distribution shift**, with a specific shape.

Why this one for CULT.MERGE:

1. **Minimal data/state changes**. You already have `appliedUpgrades` and `spawnCapLevel`. Swap the single-line `Math.min(base + bonus, cap)` in `generator.ts:69` for a small procedural spreader — no new entities, no new user-facing toggles, no extra UI state.
2. **Preserves the progression feel**. Expected level *rises* with each upgrade; the player sees more high-level creatures per charge. It still reads as "stronger."
3. **Fixes the root cause**. Low-level tasks remain completable because Lv1 never reaches 0% probability (until the creator explicitly wants it to at the final upgrade tier).
4. **The queued-charge bump goes away cleanly**. That step in `applyLineUpgradeAction` (`gameStore.ts:1738-1741`) becomes unnecessary — future rolls naturally reflect the new distribution, and existing charges were legitimately rolled under the old distribution. One fewer side effect.

**Minimum viable implementation**:

1. Add to `LineUpgradeLineConfig`: optional `spreadWeights: number[]` (length = maxAppliedUpgrades + 1). Default e.g. `[[1], [0.55, 0.45], [0.3, 0.4, 0.3], [0.15, 0.3, 0.35, 0.2], ...]` — weight index `k` = probability of `baseLevel + k`.
2. Replace `applyLineUpgradeToLevel` with `rollLineUpgradedLevel(rng, baseLevel, bonus, cap, weights)` that picks `baseLevel + k` by `weights`, clamps to cap.
3. Delete the charge-bumping pass in `applyLineUpgradeAction` and the equivalent in `SimulationEngine.ts`.
4. Update tests: `generator.lineUpgrades.test.ts`, `SimulationEngine.lineUpgrade.test.ts`, `lineUpgrades.test.ts`. Add a statistical test (seeded RNG, 10k samples, assert ±3% of expected share).
5. Run `scripts/run-experiment.ts` with a new `lvl15-dist-shift` experiment to validate pacing vs `lvl15-gen-upgrade`.

**Secondary fallback: (c) per-generator tier toggle** — adopt only if playtesting shows players *want* guaranteed high tiers. Adds UI but is orthogonal; could layer on top of (a) later (toggle chooses distribution curve).

## 5. Open Questions

- **Should low-level creatures still be obtainable at max upgrade tier, or is it OK if the final upgrade truly removes Lv1?** This determines whether the top of `spreadWeights` zeroes out the bottom or retains a 5-10% tail.
- **How rare is "rare enough" for low-tier?** If a quest demands 5× Lv1 Creature1 and probability drops to 5%, that's ~100 spawns at worst. Acceptable? Or should there be a floor guarantee (e.g. min 15% weight on base)?
- **Is the queued-charge bump a *feature* players love?** Removing it means "applying an upgrade" has no immediate visible effect until the next charge. Could compensate by auto-charging the next slot on upgrade.
- **Should upgrades be reversible / re-sellable?** Affects whether the player fears "ruining" a line.
- **Do tasks themselves need repair?** An alternative is to change *task generation* to only request low levels while they remain common, rather than changing spawns.
- **Do we want the same curve for every line, or per-line tuning?** The schema already supports overrides — cheap to add per-line `spreadWeights`, but starts another balancing project.
