# Fairness solver — design (roadmap piece 2)

Date: 2026-10-05

## Problem

The HOD re-solves in rounds (pre-fill, solve, review, restrict, re-solve) and judges a deployment by fairness. Today the solver cannot express that:

- `balance` (`src/layers/balance.js`) measures periods as a percentage of each teacher's own cap. Nothing balances the **number of classes**, which the HOD says is the most sensitive measure.
- `stable` (`src/layers/stable.js`, default weight 5) rewards keeping the current assignments, so a re-solve cannot move anyone far (the "Yiting stuck at 5" problem). The HOD wants only locks to persist.
- The soft weights are on mixed scales (percentage points, groups, periods), so a weight does not mean the same thing across layers and the HOD cannot tell what a good weight is.

Requirements and roadmap: `~/.claude/plans/grill-me-extensively-until-logical-chipmunk.md`. This is piece 2; the data and rule layers (piece 1) are in PR #3.

## Scope

In scope: a class-count fairness layer with per-teacher ideals, one common scale for all fairness measures, three presets plus advanced sliders, retiring `balance` and `stable`, and a plain-language "what this solve gave up" report.

Out of scope (later pieces): the live insights panel and guided questions, ranked alternatives and the checkpoint tree, the export table, setter/marker duties, any AI use.

## Agreed decisions

- **Priority order:** class count, then big/small mix, then preps (subject + stream + level), then graduating spread.
- **Weighted trade-offs**, not strict lexicographic order. Strict order may not be possible in practice, and one solve is faster.
- **The system removes the guesswork, not the choice:** every measure is counted in "classes off ideal", the HOD picks a preset or nudges four 1-5 sliders, and each Solve reports what it gave up.
- **Control:** presets plus advanced sliders.
- **Class-count ideal:** a typed per-teacher target wins; roles marked "fill to cap" (HOD and SH/ST by default) are pulled toward 100% of their own cap; everyone else shares the remaining classes in proportion to cap.
- A team-taught group counts as 1 class for each teacher.
- Only locks stay fixed on a re-solve: `stable` is retired.

## Constraints (from project CLAUDE.md)

- No build step; native ES modules only.
- No real student/teacher data in the repo; the sample school stays fictional.
- Re-opening a saved file or restoring a version never re-solves. Old files without the new fields load unchanged and behave as "Class count first".
- Layers follow the registry contract (`src/layers/registry.js`); constraint names are `<layerId>_<entityId>`; a hard layer that can be individually infeasible gets a prefix in `HARD_PREFIXES` and an `explainConstraint()` case. All new layers here are soft.
- The HiGHS solve stays offline and deterministic.

## Design

### 1. Measures (all in "classes off ideal")

1. **Class count:** sum over teachers of |classes − ideal|. New layer `classCount`.
2. **Big/small mix:** existing `mix` layer (|big − small| per teacher), unchanged logic.
3. **Preps:** existing `preps` layer (distinct subject + stream + level per teacher), unchanged logic.
4. **Graduating spread:** existing `graduatingSpread` layer (groups above 2 per teacher), unchanged logic.

The hard rules (caps, qualification, form teacher, deny list, graduating maximum 3, band clashes, exact big/small counts, locks) are unchanged.

### 2. Ideal class counts (`idealClassCounts(data)` in new `src/fairness.js`)

Let `seats` be the total of `teachersNeeded` over all groups, and `avgP` the average periods per seat. Each teacher's **reachable count** is the number of groups they are qualified for and not denied (a team-taught group counts once), capped by `maxGroups` when set and by `bigCount + smallCount` when both are set. No ideal is ever above the reachable count.

1. A teacher with `targetClasses` set uses that number, capped at their reachable count (soft: it is an ideal, not a rule).
2. A teacher whose role has `fillToCap` uses `cap / avgP`, capped at their reachable count.
3. The remaining seats (`seats` minus the sums from 1 and 2, floored at 0) are shared among all other non-placeholder teachers in proportion to cap, water-filled: anyone whose share is above their reachable count gets exactly that count and leaves the pool, and the rest is re-shared among the others until nobody is above.
4. Placeholder teachers, teachers with no cap and teachers whose reachable count is 0 are skipped. If every teacher is covered by 1 or 2, nothing is shared.

### 3. `classCount` layer (`src/layers/classCount.js`)

Soft, default weight from the fairness setting. Per teacher with an ideal `I` and a variable-set `Σx` over their eligible groups, the deviation has two tiers: `near` (the first class off ideal) and `far` (anything beyond one class). Rows `classCount_hi_<teacherId>`: `Σx − near − far ≤ I`, `classCount_lo_<teacherId>`: `Σx + near + far ≥ I` and `classCount_near_<teacherId>`: `near ≤ 1`; objective `weight × near + 2 × weight × far`. So the first class off ideal costs `w` and each further class `2w`, which spreads any slack evenly instead of piling it on one teacher. The `near`/`far` variables are continuous and ≥ 0 (not declared Binary), as in `mix.js`. A team-taught group is one variable per teacher, so it counts once for each.

### 4. Fairness emphasis (`src/fairness.js` and the Solve tab)

- Stored as `data.settings.fairness = { preset, levels: { classCount, mix, preps, graduating } }` (levels 1 to 5). Absent means preset `classCountFirst`. Changing a slider sets `preset` to `"custom"`.
- Weight for a level `n` is `4^(n−1)` (1, 4, 16, 64, 256). One step of difference means the higher priority usually wins a trade-off; two steps almost always.
- Starting presets, to be tuned on the sample school: `classCountFirst` 5/4/3/2, `balanced` 4/4/3/3, `fewerPreps` 4/3/5/2 (class count / mix / preps / graduating).
- `fairnessWeights(data)` returns the four weights. `buildModel` (`src/model.js`, `weightOf`) uses it for the layers `classCount`, `mix`, `preps` and `graduatingSpread` and ignores any `layerSettings` weight for them. The Layers tab still toggles each layer on or off but shows "weight set by Fairness emphasis" in place of a weight box.
- UI: a "Fairness emphasis" card at the top of the Solve tab: three preset buttons and an Advanced section with the four sliders, each with a plain-language label and the current preset name. Every change gives visible feedback.

### 5. Retiring `balance` and `stable`

Remove `balance.js` and `stable.js` from `src/layers/registry.js`, delete the files and their tests, and drop their entries from `sample/sample.json`'s `layerSettings`. A saved deployment's `layerSettings` still contains `balance` and `stable`; `buildModel` only reads settings for registered layers, so they are ignored with no data migration.

### 6. New fields

- `teacher.targetClasses?: number|null` (whole number ≥ 0). Teachers table: a **Target classes** column next to the big/small counts.
- `role.fillToCap?: boolean`. Roles table: a **Fill to cap** checkbox. When absent it defaults to `true` for role ids `hod` and `sh_st`, otherwise `false`; ticking or unticking saves an explicit value.
- `validate()`, the JSDoc typedefs, `sample/sample.json` and Excel round trip (`Roles.fillToCap`, `Teachers.targetClasses`, `Settings` keys `fairnessPreset` and `fairnessLevels` as `"5, 4, 3, 2"`) gain these. Old files gain no keys.

### 7. "What this solve gave up" (`fairnessReport(data)`)

Pure function over the assigned deployment, returning for each measure the worst teacher and a count, and rendered as short plain-language lines under the Solve button and on the Board, for example:

- "Class count: everyone is within 1 class of ideal; the largest gap is Mdm X at +2."
- "Mix: 2 teachers are off even (3 big, 1 small)."
- "Preps: the most any teacher holds is 4."
- "Graduating: nobody is above 2."

The same function will feed the insights panel and scorecard in later pieces.

## Error handling

- Pure helpers (`idealClassCounts`, `fairnessWeights`, `fairnessReport`) are fail-safe: they never throw, and bad or missing input falls back to the defaults.
- A `targetClasses` or `fairness` value that is malformed is rejected by `validate()` with a plain message and, if it slips through, ignored in favour of the default.
- No new hard constraints, so no new infeasibility messages; `diagnose.js` is unchanged.

## Testing

- Unit, on the real solver (`tests/unit/layers/classCount.test.js`): equal caps give an even split; unequal caps follow cap share; a fill-to-cap role ends near its cap; a typed target is honoured; two weights one step apart favour the higher priority.
- Unit: `idealClassCounts` and `fairnessReport` edge cases (no teachers, one teacher, a team-taught group, every teacher fill-to-cap, a placeholder), and `fairnessWeights` for every preset and custom levels.
- Unit: an old file with none of the new fields validates, round-trips through Excel without gaining keys, and builds a model with the default "Class count first" weights; retired layers are ignored when present in `layerSettings`.
- E2E (Playwright): choosing a preset and moving a slider saves the setting; a Solve on the sample shows the report; the Layers tab shows no weight box for the four fairness layers.
- Manual: a Solve on the sample school and, by the HOD, on a copy of the real deployment to confirm the presets feel right.

## Risks

- **Tuning:** the preset numbers are starting values; they must be checked against the shape of the real deployment, and may change before merge.
- **Fill to cap** can leave ordinary teachers lighter than their cap share. This is the HOD's chosen trade-off, and a typed target overrides it per teacher.
- **Solve time** rises slightly (about one extra continuous variable per teacher), which is negligible at this size.
- **First Solve after merge** will give a different result from the old objective, even for the same data.

## Planning amendments

Found while reading the code during planning:

1. **Placeholder avoidance always outranks the fairness weights.** `fairnessWeights` also returns `placeholder` = 10 x the largest of the four fairness weights, and `buildModel` uses it for the `placeholder` layer. The placeholder layer's weight box is replaced by a note, and its saved weight is ignored.
2. **Test fixtures gained an `only(layerId, level)` helper** in `tests/unit/layers/rulesFixture.js`, and the existing layer tests were migrated off `layerSettings` weights (those are now ignored for the four fairness layers).
3. **Weight resolution:** the four fairness layers and `placeholder` always take their weight from `settings.fairness` (or the `classCountFirst` default). The on/off toggle still comes from `layerSettings`.
4. **Reachable counts** (final review): a fill-to-cap ideal of `cap / avgP` could overstate what a teacher can hold (qualifications, deny rules, `maxGroups`, fixed big/small counts). The leftover seats then shrank, every ordinary teacher sat above their ideal, and the class-count term stopped caring how classes were shared (a repro gave 1/1/4 instead of 2/2/2). Ideals are now capped at each teacher's reachable count, teachers who can reach no group are left out, and the shares are water-filled.
5. **Two-tier deviation** (final review): the single `dev` per teacher became `near` (bounded at 1 by a row, weight `w`) and `far` (weight `2w`), so leftover slack is spread evenly. The placeholder weight is unchanged (10x the largest fairness weight, still 5x the marginal `2w`).

Also:

- The Solve-tab report is appended to the existing "Solved." status.
- The advanced sliders sit in a collapsed "Advanced" section.
- The Roles "Fill to cap" checkbox and the Teachers "Target classes" column are on the Teachers tab.
