// L-balance (soft): spread teaching load fairly, measured as each teacher's
// share of their OWN cap (so a HOD capped at 36 is compared like-for-like
// with a teacher capped at 60), not as raw periods.
//
// Two objective terms, both linear (no extra binaries):
//  - Range: minimise (highest utilisation - lowest utilisation), in
//    percentage points. Stops anyone being left far above or below the pack.
//  - Deviation: minimise each teacher's distance (in periods) from their
//    proportional share of total demand, so teachers between the extremes
//    also settle near the same utilisation instead of drifting anywhere.
//
// Teachers with no cap, no eligible pairs, or the placeholder flag are left
// out - they would otherwise pin the "lowest utilisation" at 0 for reasons
// that have nothing to do with fairness.
//
// The auxiliary variables (bal_max, bal_min, bal_dev_<teacher>) are not
// declared Binary in the LP, so they stay continuous and >= 0.

import { effectiveCap } from "../data.js";

const MAX_VAR = "bal_max";
const MIN_VAR = "bal_min";
const DEVIATION_SHARE = 0.5; // Deviation term weight, relative to the range term.

const balanceLayer = {
  id: "balance",
  name: "Balance load",
  kind: "soft",
  defaultWeight: 1,
  describe() {
    return "Spread teaching load fairly: keep every teacher's load as close as possible to the same share of their own maximum.";
  },
  build(ctx) {
    const weight = ctx.weight("balance");
    if (!weight) return;

    // Per-teacher load expression (periods) over the pairs that have a variable.
    const members = [];
    for (const t of ctx.data.teachers) {
      if (t.isPlaceholder) continue;
      const cap = effectiveCap(ctx.data, t);
      if (!(cap > 0)) continue;
      const terms = [];
      for (const g of ctx.data.groups) {
        const varName = ctx.x(t.id, g.id);
        if (varName) terms.push({ coef: g.periods, varName });
      }
      if (terms.length > 0) members.push({ id: t.id, cap, terms });
    }
    if (members.length < 2) return;

    const totalCap = members.reduce((sum, m) => sum + m.cap, 0);
    const totalDemand = ctx.data.groups.reduce(
      (sum, g) => sum + g.periods * (g.teachersNeeded || 1),
      0,
    );
    const targetShare = totalDemand / totalCap; // Fair utilisation, 0..1

    for (const m of members) {
      // utilisation% = 100 * load / cap, bounded above by MAX_VAR and below by MIN_VAR.
      const scaled = m.terms.map((t) => ({
        coef: t.coef * 100,
        varName: t.varName,
      }));
      ctx.addConstraint(
        `balance_max_${m.id}`,
        [...scaled, { coef: -m.cap, varName: MAX_VAR }],
        "<=",
        0,
      );
      ctx.addConstraint(
        `balance_min_${m.id}`,
        [...scaled, { coef: -m.cap, varName: MIN_VAR }],
        ">=",
        0,
      );

      // |load - target| via a non-negative deviation variable.
      const target = m.cap * targetShare;
      const dev = `bal_dev_${m.id}`.replace(/[^A-Za-z0-9_]/g, "_");
      ctx.addConstraint(
        `balance_devHi_${m.id}`,
        [...m.terms, { coef: -1, varName: dev }],
        "<=",
        target,
      );
      ctx.addConstraint(
        `balance_devLo_${m.id}`,
        [...m.terms, { coef: 1, varName: dev }],
        ">=",
        target,
      );
      ctx.addObjectiveTerm(weight * DEVIATION_SHARE, dev);
    }

    ctx.addObjectiveTerm(weight, MAX_VAR);
    ctx.addObjectiveTerm(-weight, MIN_VAR);
  },
};

export { balanceLayer };
