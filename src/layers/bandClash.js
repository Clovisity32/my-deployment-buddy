// L-bandClash (hard): two teaching groups in the same band run at the same
// timetable slot, so one teacher cannot be assigned to more than one group
// within the same band.

const bandClashLayer = {
  id: "bandClash",
  name: "Band clash",
  kind: "hard",
  defaultWeight: 0,
  describe(data) {
    const n = (data.bands || []).length;
    return n > 0
      ? `Within a band, one teacher cannot be assigned to two groups that run at the same time (${n} band(s) defined).`
      : "Within a band, one teacher cannot be assigned to two groups that run at the same time (no bands defined yet).";
  },
  build(ctx) {
    for (const band of ctx.data.bands || []) {
      const groupsInBand = ctx.data.groups.filter((g) => g.bandId === band.id);
      if (groupsInBand.length < 2) continue; // no clash possible with 0 or 1 group
      for (const t of ctx.data.teachers) {
        const terms = [];
        for (const g of groupsInBand) {
          const varName = ctx.x(t.id, g.id);
          if (varName) terms.push({ coef: 1, varName });
        }
        if (terms.length > 1) {
          ctx.addConstraint(`bandClash_${band.id}_${t.id}`, terms, "<=", 1);
        }
      }
    }
  },
};

export { bandClashLayer };
