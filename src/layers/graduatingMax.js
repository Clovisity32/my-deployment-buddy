// L-graduatingMax (hard): no teacher takes more than the maximum number of
// graduating groups (default Sec 4 and Sec 5, at most 3). Counted in groups,
// once per teacher, so a team-taught group counts as one for each teacher.
// Placeholder teachers are left out - they exist to absorb a shortage.

import { graduatingSettings } from "../data.js";

const graduatingMaxLayer = {
  id: "graduatingMax",
  name: "Graduating classes: hard maximum",
  kind: "hard",
  defaultWeight: 0,
  describe(data) {
    const { levels, max } = graduatingSettings(data);
    return `No teacher takes more than ${max} graduating group(s) (Sec ${levels.join("/")}).`;
  },
  build(ctx) {
    const { levels, max } = graduatingSettings(ctx.data);
    for (const t of ctx.data.teachers) {
      if (t.isPlaceholder) continue;
      const terms = [];
      for (const g of ctx.data.groups) {
        if (!levels.includes(g.level)) continue;
        const varName = ctx.x(t.id, g.id);
        if (varName) terms.push({ coef: 1, varName });
      }
      if (terms.length > max) {
        ctx.addConstraint(`graduatingMax_${t.id}`, terms, "<=", max);
      }
    }
  },
};

export { graduatingMaxLayer };
