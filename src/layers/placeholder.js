// L-placeholder (soft): prefer real teachers over a "New Teacher" placeholder.
// A placeholder is only used when no real, qualified teacher can cover the
// load - this surfaces exactly where a hiring gap exists.

const placeholderLayer = {
  id: "placeholder",
  name: "Avoid placeholder teachers",
  kind: "soft",
  defaultWeight: 50,
  describe(data) {
    const names = data.teachers
      .filter((t) => t.isPlaceholder)
      .map((t) => t.name);
    return names.length > 0
      ? `Prefer real teachers over placeholder(s) (${names.join(", ")}); a placeholder is only used when no real teacher can cover a group.`
      : "Prefer real teachers over placeholders (none defined yet).";
  },
  build(ctx) {
    const weight = ctx.weight("placeholder");
    if (!weight) return;
    const placeholderIds = new Set(
      ctx.data.teachers.filter((t) => t.isPlaceholder).map((t) => t.id),
    );
    if (placeholderIds.size === 0) return;
    for (const { teacherId, groupId } of ctx.pairs) {
      if (placeholderIds.has(teacherId)) {
        ctx.addObjectiveTerm(weight, ctx.x(teacherId, groupId));
      }
    }
  },
};

export { placeholderLayer };
