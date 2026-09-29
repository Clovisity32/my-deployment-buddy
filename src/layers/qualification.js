// L1 - Subject qualification (hard): a teacher may only be assigned to a
// group in a subject they are qualified for. Enforced structurally by
// filterPairs(), which removes unqualified (teacher, group) combinations
// before any decision variable is created - this is what keeps the model
// small as more layers and more groups are added. build() is a no-op.

const qualificationLayer = {
  id: "qualification",
  name: "Subject qualification",
  kind: "hard",
  defaultWeight: 0,
  describe() {
    return "Teachers may only be assigned to groups in a subject they are qualified to teach.";
  },
  filterPairs(data, pairs) {
    const teacherById = new Map(data.teachers.map((t) => [t.id, t]));
    const groupById = new Map(data.groups.map((g) => [g.id, g]));
    return pairs.filter(({ teacherId, groupId }) => {
      const t = teacherById.get(teacherId);
      const g = groupById.get(groupId);
      // A group with no subjectId (a legacy/custom group) fails closed - it
      // never matches any teacher here, so it surfaces as "no qualified
      // teacher" via the coverage pre-check in diagnose.js rather than
      // silently letting everyone teach it.
      return Boolean(
        t &&
        g &&
        Array.isArray(t.qualifications) &&
        g.subjectId &&
        t.qualifications.includes(g.subjectId),
      );
    });
  },
  build() {
    // No-op - see filterPairs() above.
  },
};

export { qualificationLayer };
