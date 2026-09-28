// L2 - Load cap (hard): no teacher is given more periods per week than
// their maximum load (reduced caps for HODs, beginning teachers, part-timers
// are just a smaller maxPeriods on that teacher - no special-casing needed).

const loadCapLayer = {
  id: "loadCap",
  name: "Load cap",
  kind: "hard",
  defaultWeight: 0,
  describe() {
    return "No teacher is given more periods per week than their maximum load.";
  },
  build(ctx) {
    for (const t of ctx.data.teachers) {
      const terms = [];
      for (const g of ctx.data.groups) {
        const varName = ctx.x(t.id, g.id);
        if (varName) terms.push({ coef: g.periods, varName });
      }
      if (terms.length > 0) {
        ctx.addConstraint(`loadCap_${t.id}`, terms, "<=", t.maxPeriods);
      }
    }
  },
};

export { loadCapLayer };
