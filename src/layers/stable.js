// L-stable (soft): when re-solving, prefer to keep the current deployment
// and change as few assignments as possible, rather than reshuffling
// everything. This is what makes "edit one teacher's cap and re-solve"
// produce a minimal diff instead of a brand new layout.

const stableLayer = {
  id: "stable",
  name: "Minimise changes",
  kind: "soft",
  defaultWeight: 5,
  describe() {
    return "When re-solving, keep as much of the current deployment as possible and change only what is needed.";
  },
  build(ctx) {
    const weight = ctx.weight("stable");
    if (!weight) return;
    const current = new Set(
      (ctx.data.assignments || []).map((a) => `${a.teacherId}|${a.groupId}`),
    );
    for (const { teacherId, groupId } of ctx.pairs) {
      const varName = ctx.x(teacherId, groupId);
      if (current.has(`${teacherId}|${groupId}`)) {
        ctx.addObjectiveTerm(-weight, varName); // Reward keeping an existing assignment.
      } else {
        ctx.addObjectiveTerm(weight, varName); // Penalise introducing a new one.
      }
    }
  },
};

export { stableLayer };
