// L-preps (soft): keep each teacher's number of different subjects (preps) as
// low as possible. A prep is one subject a teacher has at least one group in,
// e.g. G2_SCI_CHEM and G3_SCI_CHEM are two preps.
//
// Per (teacher, subject) a 0/1 variable y is forced to 1 whenever the teacher
// takes any group of that subject, and each y costs `weight` in the
// objective. Only the y variables are extra binaries; they never appear in
// the parsed assignments (solve.js only reads the assignment variables).

const prepsLayer = {
  id: "preps",
  name: "Fewer preps",
  kind: "soft",
  defaultWeight: 0.5, // A bonus, not a priority: on the real deployment 0.5 cut total preps ~19% at no cost to load spread; 1+ trades spread for preps.
  describe() {
    return "Keep each teacher's number of different subjects (preps) as low as possible.";
  },
  build(ctx) {
    const weight = ctx.weight("preps");
    if (!weight) return;

    const subjectOf = (g) => g.subjectId || g.block;
    let n = 0;
    for (const t of ctx.data.teachers) {
      if (t.isPlaceholder) continue;
      const bySubject = new Map();
      for (const g of ctx.data.groups) {
        const varName = ctx.x(t.id, g.id);
        if (!varName) continue;
        const s = subjectOf(g);
        if (!bySubject.has(s)) bySubject.set(s, []);
        bySubject.get(s).push(varName);
      }
      for (const vars of bySubject.values()) {
        const y = ctx.declareBinary(`prep_${n++}`);
        for (const varName of vars) {
          // x <= y: taking the group switches the prep on.
          ctx.addConstraint(
            `preps_${y}_${varName}`,
            [
              { coef: 1, varName },
              { coef: -1, varName: y },
            ],
            "<=",
            0,
          );
        }
        ctx.addObjectiveTerm(weight, y);
      }
    }
  },
};

export { prepsLayer };
