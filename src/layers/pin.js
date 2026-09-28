// L-pin (hard): a locked assignment is fixed in every re-solve, so a manual
// edit the HOD made and locked can never be moved by a later Solve.

const pinLayer = {
  id: "pin",
  name: "Locked assignments",
  kind: "hard",
  defaultWeight: 0,
  describe(data) {
    const n = (data.assignments || []).filter((a) => a.locked).length;
    return n > 0
      ? `${n} assignment(s) are locked and will stay fixed when solving.`
      : "Locked assignments are fixed in every solve (none are currently locked).";
  },
  build(ctx) {
    for (const a of ctx.data.assignments || []) {
      if (!a.locked) continue;
      const varName = ctx.x(a.teacherId, a.groupId);
      if (!varName) continue; // Locked pair isn't a valid/qualified pair - a data issue, surfaced by diagnose.js.
      ctx.addConstraint(
        `pin_${a.teacherId}_${a.groupId}`,
        [{ coef: 1, varName }],
        "=",
        1,
      );
    }
  },
};

export { pinLayer };
