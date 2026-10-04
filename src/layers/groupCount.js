// L-groupCount (hard): per-teacher limits on how many groups (classes) they
// get, counted in groups rather than periods:
//   - maxGroups  : at most this many groups in total
//   - bigCount   : exactly this many big groups (the big/small cut-off, default 10 periods)
//   - smallCount : exactly this many small groups
// A blank (null/undefined) field means "no rule". A count of 0 is a real rule
// ("no big groups"). A teacher with no eligible pair still gets their row (with
// empty terms) so an unreachable exact count shows up as infeasible instead of
// being silently ignored.

import { bigThreshold } from "../data.js";

/** @param {any} v */
function isSet(v) {
  return typeof v === "number" && Number.isFinite(v);
}

const groupCountLayer = {
  id: "groupCount",
  name: "Class counts per teacher",
  kind: "hard",
  defaultWeight: 0,
  describe(data) {
    return `Respects each teacher's maximum number of groups and their exact number of big (${bigThreshold(data)}+ periods) and small groups, where set.`;
  },
  build(ctx) {
    const threshold = bigThreshold(ctx.data);
    for (const t of ctx.data.teachers) {
      if (!isSet(t.maxGroups) && !isSet(t.bigCount) && !isSet(t.smallCount))
        continue;

      const all = [];
      const big = [];
      const small = [];
      for (const g of ctx.data.groups) {
        const varName = ctx.x(t.id, g.id);
        if (!varName) continue;
        const term = { coef: 1, varName };
        all.push(term);
        (g.periods >= threshold ? big : small).push(term);
      }

      if (isSet(t.maxGroups))
        ctx.addConstraint(`groupCount_max_${t.id}`, all, "<=", t.maxGroups);
      if (isSet(t.bigCount))
        ctx.addConstraint(`groupCount_big_${t.id}`, big, "=", t.bigCount);
      if (isSet(t.smallCount))
        ctx.addConstraint(`groupCount_small_${t.id}`, small, "=", t.smallCount);
    }
  },
};

export { groupCountLayer, isSet };
