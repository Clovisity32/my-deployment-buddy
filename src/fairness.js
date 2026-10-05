// Fairness: the one place that turns the HOD's fairness emphasis into numbers.
// Pure and fail-safe (never throws, never mutates). Used by buildModel (weights),
// the classCount layer (ideal class counts) and the report after a Solve.

import { effectiveCap, fairnessSettings, roleFillsToCap } from "./data.js";

/** Which `fairnessSettings().levels` key each layer's weight comes from. */
const FAIRNESS_KEY_BY_LAYER = {
  classCount: "classCount",
  mix: "mix",
  preps: "preps",
  graduatingSpread: "graduating",
};

/**
 * Objective weights: 4^(level-1) per fairness measure, so one step of
 * difference means the higher priority usually wins a trade-off and two steps
 * almost always do. `placeholder` is 10x the largest of them: using the "New
 * Teacher" placeholder must never be cheaper than a real teacher's fairness gap.
 * @param {any} data
 * @returns {{classCount:number, mix:number, preps:number, graduating:number, placeholder:number}}
 */
function fairnessWeights(data) {
  const { levels } = fairnessSettings(data);
  const w = {
    classCount: 4 ** (levels.classCount - 1),
    mix: 4 ** (levels.mix - 1),
    preps: 4 ** (levels.preps - 1),
    graduating: 4 ** (levels.graduating - 1),
  };
  return {
    ...w,
    placeholder: 10 * Math.max(w.classCount, w.mix, w.preps, w.graduating),
  };
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * The ideal number of classes for each real teacher:
 *  1. a typed `targetClasses` is used as-is;
 *  2. a teacher whose role is "fill to cap" gets cap / (average periods per seat);
 *  3. the remaining seats (never below 0) are shared by everyone else in
 *     proportion to cap.
 * A team-taught group is one seat per teacher it needs. Placeholder teachers,
 * teachers with no cap and teachers qualified for none of the groups are left out.
 * @param {any} data
 * @returns {Map<string, number>}
 */
function idealClassCounts(data) {
  const out = new Map();
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const teachers = Array.isArray(data?.teachers) ? data.teachers : [];
  const roles = Array.isArray(data?.roles) ? data.roles : [];

  let seats = 0;
  let seatPeriods = 0;
  for (const g of groups) {
    const need =
      isNum(g?.teachersNeeded) && g.teachersNeeded > 0 ? g.teachersNeeded : 1;
    seats += need;
    seatPeriods += (isNum(g?.periods) ? g.periods : 0) * need;
  }
  if (seats === 0) return out;
  const avgPeriods = seatPeriods / seats;

  const subjects = new Set(groups.map((g) => g?.subjectId).filter(Boolean));
  const members = teachers.filter((t) => {
    if (!t || t.isPlaceholder) return false;
    if (!(effectiveCap(data, t) > 0)) return false;
    return (Array.isArray(t.qualifications) ? t.qualifications : []).some((s) =>
      subjects.has(s),
    );
  });

  const roleById = new Map(roles.map((r) => [r?.id, r]));
  let fixed = 0;
  const sharers = [];
  for (const t of members) {
    if (isNum(t.targetClasses) && t.targetClasses >= 0) {
      out.set(t.id, t.targetClasses);
      fixed += t.targetClasses;
    } else if (roleFillsToCap(roleById.get(t.roleId)) && avgPeriods > 0) {
      const ideal = effectiveCap(data, t) / avgPeriods;
      out.set(t.id, ideal);
      fixed += ideal;
    } else {
      sharers.push(t);
    }
  }

  const rest = Math.max(0, seats - fixed);
  const capSum = sharers.reduce((sum, t) => sum + effectiveCap(data, t), 0);
  for (const t of sharers) {
    out.set(t.id, capSum > 0 ? (rest * effectiveCap(data, t)) / capSum : 0);
  }
  return out;
}

export { FAIRNESS_KEY_BY_LAYER, fairnessWeights, idealClassCounts };
