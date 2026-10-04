// L-formTeacher (hard): the form teacher of a class must teach at least one
// group that contains that class (any subject they are qualified for). A
// class with no group at all is skipped - there is nothing to teach - and a
// form teacher who can't teach any of the class's groups leaves an empty row
// on purpose, so the model is infeasible and diagnose.js can say why.

const formTeacherLayer = {
  id: "formTeacher",
  name: "Form teachers teach their class",
  kind: "hard",
  defaultWeight: 0,
  describe(data) {
    const n = (data.classes || []).filter((c) => c.formTeacherId).length;
    return n > 0
      ? `${n} form teacher(s) must teach at least one group that includes their form class.`
      : "A form teacher must teach their form class (no form teachers set yet).";
  },
  build(ctx) {
    const teacherIds = new Set(ctx.data.teachers.map((t) => t.id));
    for (const c of ctx.data.classes || []) {
      if (!c.formTeacherId || !teacherIds.has(c.formTeacherId)) continue;
      const classGroups = ctx.data.groups.filter(
        (g) => Array.isArray(g.classIds) && g.classIds.includes(c.id),
      );
      if (classGroups.length === 0) continue;
      const terms = [];
      for (const g of classGroups) {
        const varName = ctx.x(c.formTeacherId, g.id);
        if (varName) terms.push({ coef: 1, varName });
      }
      ctx.addConstraint(`formTeacher_${c.id}`, terms, ">=", 1);
    }
  },
};

export { formTeacherLayer };
