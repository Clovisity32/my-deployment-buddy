// Fairness: the one place that turns the HOD's fairness emphasis into numbers.
// Pure and fail-safe (never throws, never mutates). Used by buildModel (weights),
// the classCount layer (ideal class counts) and the report after a Solve.

import {
  bigThreshold,
  effectiveCap,
  fairnessSettings,
  graduatingSettings,
  prepKey,
  roleFillsToCap,
} from "./data.js";

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

/** @param {number} n */
const signed = (n) => `${n > 0 ? "+" : ""}${Math.round(n * 10) / 10}`;

/**
 * Plain-language lines about how fair the current assignments are, one per
 * measure. Empty when nothing is assigned. Placeholder teachers are ignored.
 * @param {any} data
 * @returns {{key:"classCount"|"mix"|"preps"|"graduating", text:string}[]}
 */
function fairnessReport(data) {
  const teachers = (Array.isArray(data?.teachers) ? data.teachers : []).filter(
    (t) => t && !t.isPlaceholder,
  );
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const assignments = Array.isArray(data?.assignments) ? data.assignments : [];
  if (assignments.length === 0 || teachers.length === 0) return [];

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const held = new Map(teachers.map((t) => [t.id, []]));
  for (const a of assignments) {
    const g = groupById.get(a?.groupId);
    if (g && held.has(a.teacherId)) held.get(a.teacherId).push(g);
  }
  if ([...held.values()].every((gs) => gs.length === 0)) return [];

  const out = [];
  const byId = new Map(teachers.map((t) => [t.id, t]));

  // Class count: the largest gap from each teacher's ideal.
  const ideals = idealClassCounts(data);
  let worst = null;
  for (const [id, ideal] of ideals) {
    const gap = (held.get(id)?.length ?? 0) - ideal;
    if (!worst || Math.abs(gap) > Math.abs(worst.gap)) worst = { id, gap };
  }
  if (worst) {
    out.push({
      key: "classCount",
      text:
        Math.abs(worst.gap) < 0.5
          ? "Class count: everyone is on their ideal number of classes."
          : `Class count: everyone is within ${Math.ceil(Math.abs(worst.gap))} class(es) of their ideal; the largest gap is ${byId.get(worst.id).name} at ${signed(worst.gap)}.`,
    });
  }

  // Mix: more than 1 away from an even big/small split.
  const threshold = bigThreshold(data);
  const off = [];
  for (const t of teachers) {
    const gs = held.get(t.id) || [];
    const big = gs.filter((g) => g.periods >= threshold).length;
    const diff = Math.abs(big - (gs.length - big));
    if (diff > 1) off.push({ name: t.name, big, small: gs.length - big, diff });
  }
  off.sort((a, b) => b.diff - a.diff);
  out.push({
    key: "mix",
    text:
      off.length === 0
        ? "Mix: every teacher is within 1 of an even big/small split."
        : `Mix: ${off.length} teacher(s) are more than 1 away from an even big/small split, most of all ${off[0].name} (${off[0].big} big, ${off[0].small} small).`,
  });

  // Preps: the most any teacher holds.
  let top = null;
  for (const t of teachers) {
    const n = new Set((held.get(t.id) || []).map(prepKey)).size;
    if (!top || n > top.n) top = { n, name: t.name };
  }
  if (top && top.n > 0) {
    out.push({
      key: "preps",
      text: `Preps: the most any teacher holds is ${top.n} (${top.name}).`,
    });
  }

  // Graduating: anyone above the preferred number.
  const { levels, prefer } = graduatingSettings(data);
  const over = [];
  for (const t of teachers) {
    const n = (held.get(t.id) || []).filter((g) =>
      levels.includes(g.level),
    ).length;
    if (n > prefer) over.push({ name: t.name, n });
  }
  over.sort((a, b) => b.n - a.n);
  out.push({
    key: "graduating",
    text:
      over.length === 0
        ? `Graduating: nobody is above ${prefer}.`
        : `Graduating: ${over.length} teacher(s) are above ${prefer}, most of all ${over[0].name} with ${over[0].n}.`,
  });
  return out;
}

export {
  FAIRNESS_KEY_BY_LAYER,
  fairnessWeights,
  idealClassCounts,
  fairnessReport,
};
