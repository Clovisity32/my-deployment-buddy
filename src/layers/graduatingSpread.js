// L-graduatingSpread (soft): revision season is intense, so aim for no more
// than the preferred number of graduating groups (default 2) per teacher.
// Each group above that costs `weight`. The over_<n> variables are not
// declared Binary, so they stay continuous and >= 0 (same as mix.js).

import { graduatingSettings } from "../data.js";

const graduatingSpreadLayer = {
  id: "graduatingSpread",
  name: "Spread graduating classes",
  kind: "soft",
  defaultWeight: 1,
  describe(data) {
    const { levels, prefer } = graduatingSettings(data);
    return `Aim for at most ${prefer} graduating group(s) (Sec ${levels.join("/")}) per teacher; each extra one is penalised.`;
  },
  build(ctx) {
    const weight = ctx.weight("graduatingSpread");
    if (!weight) return;
    const { levels, prefer } = graduatingSettings(ctx.data);
    let n = 0;
    for (const t of ctx.data.teachers) {
      if (t.isPlaceholder) continue;
      const terms = [];
      for (const g of ctx.data.groups) {
        if (!levels.includes(g.level)) continue;
        const varName = ctx.x(t.id, g.id);
        if (varName) terms.push({ coef: 1, varName });
      }
      if (terms.length <= prefer) continue; // can never go over
      const over = `grad_over_${n++}`;
      ctx.addConstraint(
        `graduatingSpread_${t.id}`,
        [...terms, { coef: -1, varName: over }],
        "<=",
        prefer,
      );
      ctx.addObjectiveTerm(weight, over);
    }
  },
};

export { graduatingSpreadLayer };
