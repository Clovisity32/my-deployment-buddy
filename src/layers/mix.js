// L-mix (soft): give each teacher about as many big groups (10+ periods) as
// small ones, so nobody ends up with only the heavy groups or only the light
// ones. Per teacher: minimise |big - small| (number of groups, not periods).
//
// A teacher who could never be given both sizes (no eligible big group, or no
// eligible small one) is left out - otherwise the penalty would just push
// that teacher toward fewer groups, which has nothing to do with mix.
//
// The deviation variables (mix_dev_<n>) are not declared Binary, so they stay
// continuous and >= 0. A perfect mix is not always possible (a teacher with
// an odd number of groups is always off by at least 1), so this is soft.

import { bigThreshold } from "../data.js";

const mixLayer = {
  id: "mix",
  name: "Mix big and small groups",
  kind: "soft",
  defaultWeight: 1,
  describe(data) {
    return `Give each teacher about as many big groups (${bigThreshold(data)}+ periods) as small ones.`;
  },
  build(ctx) {
    const weight = ctx.weight("mix");
    if (!weight) return;
    const threshold = bigThreshold(ctx.data);

    let n = 0;
    for (const t of ctx.data.teachers) {
      if (t.isPlaceholder) continue;
      // The HOD fixed this teacher's big/small counts by hand (groupCount
      // layer), so there is no mix left for the solver to balance.
      if (typeof t.bigCount === "number" || typeof t.smallCount === "number")
        continue;
      const big = [];
      const small = [];
      for (const g of ctx.data.groups) {
        const varName = ctx.x(t.id, g.id);
        if (!varName) continue;
        (g.periods >= threshold ? big : small).push(varName);
      }
      if (big.length === 0 || small.length === 0) continue;

      const dev = `mix_dev_${n++}`;
      const bigTerms = big.map((varName) => ({ coef: 1, varName }));
      const smallTerms = small.map((varName) => ({ coef: 1, varName }));
      const negate = (terms) => terms.map((x) => ({ ...x, coef: -x.coef }));
      // dev >= big - small  and  dev >= small - big
      ctx.addConstraint(
        `mix_hi_${t.id}`,
        [...bigTerms, ...negate(smallTerms), { coef: -1, varName: dev }],
        "<=",
        0,
      );
      ctx.addConstraint(
        `mix_lo_${t.id}`,
        [...negate(bigTerms), ...smallTerms, { coef: -1, varName: dev }],
        "<=",
        0,
      );
      ctx.addObjectiveTerm(weight, dev);
    }
  },
};

export { mixLayer };
