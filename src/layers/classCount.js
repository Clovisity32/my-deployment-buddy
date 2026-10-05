// L-classCount (soft): each real teacher should hold about their ideal number
// of classes (src/fairness.js idealClassCounts: typed target, else fill-to-cap
// role, else cap share). Per teacher, dev >= |classes - ideal| via two rows;
// the objective is weight x dev, so the weight is "cost per class off ideal".
// A team-taught group is one variable per teacher, so it counts once for each.
// The dev variables are not declared Binary, so they stay continuous and >= 0
// (same as mix.js). Placeholders and teachers with no eligible group are skipped.

import { idealClassCounts } from "../fairness.js";

const classCountLayer = {
  id: "classCount",
  name: "Fair class counts",
  kind: "soft",
  defaultWeight: 256, // the real weight comes from the Fairness emphasis (src/fairness.js)
  describe() {
    return "Give each teacher about their fair number of classes: in proportion to cap, a typed target, or filled close to cap for roles set to do so.";
  },
  build(ctx) {
    const weight = ctx.weight("classCount");
    if (!weight) return;
    const ideals = idealClassCounts(ctx.data);
    let n = 0;
    for (const t of ctx.data.teachers) {
      if (t.isPlaceholder || !ideals.has(t.id)) continue;
      const terms = [];
      for (const g of ctx.data.groups) {
        const varName = ctx.x(t.id, g.id);
        if (varName) terms.push({ coef: 1, varName });
      }
      if (terms.length === 0) continue;
      const ideal = ideals.get(t.id);
      const dev = `cc_dev_${n++}`;
      ctx.addConstraint(
        `classCount_hi_${t.id}`,
        [...terms, { coef: -1, varName: dev }],
        "<=",
        ideal,
      );
      ctx.addConstraint(
        `classCount_lo_${t.id}`,
        [...terms, { coef: 1, varName: dev }],
        ">=",
        ideal,
      );
      ctx.addObjectiveTerm(weight, dev);
    }
  },
};

export { classCountLayer };
