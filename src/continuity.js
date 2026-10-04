// Continuity: last year's teacher keeps their class for Sec 1 -> 2 and
// Sec 3 -> 4. Applied as ordinary LOCKED assignments, so the solver needs no
// special rule and the HOD unlocks an exception with the Board's lock toggle.
// Pure and fail-safe. Existing assignments are never changed.

import { isDenied } from "./data.js";
import { normalize } from "./intake.js";

const CARRY_OVER_LEVELS = [1, 3];

/** The class this year that last year's class became, or null. */
function targetClass(data, row) {
  const toLevel = row.level + 1;
  const classes = (data.classes || []).filter((c) => c.level === toLevel);
  const ref = String(row.classRef ?? "").trim();
  // Ids look like <level digit><suffix> (301 -> 401): keep the suffix.
  const prefix = String(row.level);
  if (
    /^\d+$/.test(ref) &&
    ref.startsWith(prefix) &&
    ref.length > prefix.length
  ) {
    const hit = classes.find(
      (c) => c.id === `${toLevel}${ref.slice(prefix.length)}`,
    );
    if (hit) return hit;
  }
  const byName = classes.filter((c) => normalize(c.name) === normalize(ref));
  return byName.length === 1 ? byName[0] : null;
}

/**
 * @param {any} data
 * @returns {{data:any, added:number, skipped:{message:string}[]}}
 */
function applyContinuity(data) {
  const lastYear = Array.isArray(data?.lastYear) ? data.lastYear : [];
  const teachers = new Map((data?.teachers || []).map((t) => [t.id, t]));
  const groups = data?.groups || [];
  const assignments = [...(data?.assignments || [])];
  const skipped = [];
  let added = 0;

  for (const row of lastYear) {
    if (!CARRY_OVER_LEVELS.includes(row.level)) continue;
    const what = `${row.subjectId} for "${row.classRef}" (Sec ${row.level} last year)`;
    const skip = (why) => skipped.push({ message: `${what}: ${why}` });

    const cls = targetClass(data, row);
    if (!cls) {
      skip(`no Sec ${row.level + 1} class matches it this year.`);
      continue;
    }
    const teacher = teachers.get(row.teacherId);
    if (!teacher) {
      skip("the teacher is no longer in the Teachers table.");
      continue;
    }
    const group = groups.find(
      (g) =>
        g.level === row.level + 1 &&
        g.subjectId === row.subjectId &&
        Array.isArray(g.classIds) &&
        g.classIds.includes(cls.id),
    );
    if (!group) {
      skip(
        `there is no group for ${cls.name} (Sec ${cls.level}) in that subject this year.`,
      );
      continue;
    }
    if (!(teacher.qualifications || []).includes(group.subjectId)) {
      skip(`${teacher.name} is not qualified for it any more.`);
      continue;
    }
    if (isDenied(teacher, group)) {
      skip(`${teacher.name} is on a deny list for it.`);
      continue;
    }
    const seats = assignments.filter((a) => a.groupId === group.id);
    if (seats.some((a) => a.teacherId === teacher.id)) {
      skip(`${teacher.name} is already placed on it (left as you have it).`);
      continue;
    }
    if (seats.length >= group.teachersNeeded) {
      skip("the group already has all the teachers it needs.");
      continue;
    }
    assignments.push({
      teacherId: teacher.id,
      groupId: group.id,
      locked: true,
    });
    added += 1;
  }

  return { data: added > 0 ? { ...data, assignments } : data, added, skipped };
}

export { applyContinuity };
