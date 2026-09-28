// L1 - Subject qualification (hard): a teacher may only be assigned to a
// group in a subject block they are qualified for. Enforced structurally by
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
      return Boolean(
        t && g && Array.isArray(t.subjects) && t.subjects.includes(g.block),
      );
    });
  },
  build() {
    // No-op - see filterPairs() above.
  },
};

export { qualificationLayer };
