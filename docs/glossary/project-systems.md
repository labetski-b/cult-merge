# Project Systems Glossary

This glossary fixes the project vocabulary without forcing a large rename. Use these terms in docs, reviews, and future cleanup sessions.

## Canonical Terms

### Kraken task

The Kraken-task loop defined by `src/data/tasks.json` and implemented in `src/domain/tasks.ts`.

- Includes both `mandatory` tasks and generated `auto` tasks.
- Starts affecting progression at Kraken level 2.
- Rewards and requirements are part of the main runtime balance loop.
- These are the tasks Kraken gives directly and the player completes.
- Preferred wording in docs: "Kraken task", not just "quest".

### Kraken quest

The unlockable Kraken-quest layer defined by `src/data/quests.json` and implemented in `src/domain/quests.ts`.

- Organized into chapters with multiple quest objectives per chapter.
- Unlocks at Kraken level 4.
- Quests are still Kraken content; "chapter" is the structure, not a separate owner/system.
- Can reference completed Kraken tasks as one of its objectives.
- Preferred wording in docs: "Kraken quest" or "unlockable Kraken quest". Use "chapter" only when the chapter structure itself matters.

### Tycoon quest

Reserved term for a future quest layer outside the current Kraken task/quest files.

- Not implemented in the current runtime data yet.
- Do not use this label for `src/data/quests.json` today.

### Balance profile

The active production data set loaded from `src/data/*.json`.

- This is the runtime source of truth for balance and progression data.
- It includes both Kraken-task data (`tasks.json`) and Kraken-quest data (`quests.json`).
- Use "balance profile" when discussing the current playable configuration as a whole.

### Experiment override

A local research change that overrides part of the balance profile from `src/data/experiments/*`.

- Usually stored as a folder with only the changed JSON files plus a README.
- Exists to compare hypotheses against the active balance profile.
- Does not become source of truth until its changes are explicitly applied back into `src/data/*.json`.

### Session notes

Working memory files that capture research context, decisions, or handoff state.

- Typical examples: `SESSION_CONTEXT.md`, `SESSION_COMPACTION.md`.
- These files explain why work happened; they are not runtime contracts.
- Use them as process history, not as the canonical description of current game behavior.

### Research archive

Historical material kept for reference after an experiment or analysis is no longer the active working surface.

- Includes completed experiments, frozen snapshots, long-form notes, and historical analyses.
- May still live under `src/data/experiments/` for now, even if the folder has not been physically split yet.
- Treat archived material as reference context, not as current balance intent.

## Boundary Rules

1. Do not call a Kraken task a Kraken quest.
2. Do not describe `quests.json` as a non-Kraken system; it is the unlockable Kraken-quest layer.
3. Treat `src/data/*.json` as the balance profile; treat `src/data/experiments/*` as experiment overrides or archive material.
4. Treat session notes as process memory, not as the contract for current gameplay.
5. Reserve "Tycoon quest" for the future layer that is not yet in the current runtime.
6. When legacy labels remain in code or UI, document the boundary instead of forcing a mass rename.

## Quick Map

| Term | Primary files | Role |
|------|---------------|------|
| Kraken task | `src/data/tasks.json`, `src/domain/tasks.ts` | Main runtime task loop |
| Kraken quest | `src/data/quests.json`, `src/domain/quests.ts` | Unlockable Kraken quest layer |
| Tycoon quest | not yet implemented in current runtime | Future quest layer |
| Balance profile | `src/data/*.json` | Active runtime configuration |
| Experiment override | `src/data/experiments/<name>/` | Temporary research delta |
| Session notes | `SESSION_CONTEXT.md`, `SESSION_COMPACTION.md` | Working context and handoff |
| Research archive | historical experiment folders and notes | Reference-only history |
