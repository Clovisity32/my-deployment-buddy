// L0 - Coverage (hard): every teaching group gets exactly the number of
// teachers it needs (1, or 2 for a co-taught group like "Ming Quan / Cerenna").

const coverageLayer = {
  id: "coverage",
  name: "Coverage",
  kind: "hard",
  defaultWeight: 0,
  describe() {
    return "Every teaching group is assigned exactly the number of teachers it needs (usually 1, or 2 for a co-taught group).";
  },
  build(ctx) {
    for (const g of ctx.data.groups) {
      const terms = [];
      for (const t of ctx.data.teachers) {
        const varName = ctx.x(t.id, g.id);
        if (varName) terms.push({ coef: 1, varName });
      }
      ctx.addConstraint(`coverage_${g.id}`, terms, "=", g.teachersNeeded);
    }
  },
};

export { coverageLayer };
