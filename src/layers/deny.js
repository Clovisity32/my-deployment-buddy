// L-deny (hard): a teacher is never given a group that matches one of their
// deny rules (a level, a stream and/or a subject, e.g. "not Sec 1 G2").
// Structural, like qualification.js: filterPairs() removes the pair before
// any variable exists, so it adds no rows and keeps the model small.
// To relax a rule, delete it from the teacher's list.

import { isDenied } from "../data.js";

const denyLayer = {
  id: "deny",
  name: "Deny list",
  kind: "hard",
  defaultWeight: 0,
  describe(data) {
    const n = (data.teachers || []).reduce(
      (sum, t) => sum + (Array.isArray(t.denies) ? t.denies.length : 0),
      0,
    );
    return n > 0
      ? `${n} deny rule(s): those teachers are never given the groups they are barred from.`
      : "Teachers can be barred from certain levels, streams or subjects (none set yet).";
  },
  filterPairs(data, pairs) {
    const teacherById = new Map(data.teachers.map((t) => [t.id, t]));
    const groupById = new Map(data.groups.map((g) => [g.id, g]));
    return pairs.filter(({ teacherId, groupId }) => {
      const t = teacherById.get(teacherId);
      const g = groupById.get(groupId);
      return !(t && g && isDenied(t, g));
    });
  },
  build() {
    // No-op - see filterPairs() above.
  },
};

export { denyLayer };
