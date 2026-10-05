// Fairness: the one place that turns the HOD's fairness emphasis into numbers.
// Pure and fail-safe (never throws, never mutates). Used by buildModel (weights),
// the classCount layer (ideal class counts) and the report after a Solve.

import {
  bigThreshold,
  effectiveCap,
  fairnessSettings,
  graduatingSettings,
  isDenied,
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
const isObj = (v) => Boolean(v) && typeof v === "object";

/**
 * How many classes this teacher could hold at most: groups they are qualified
 * for and not denied (a team-taught group counts once), capped by maxGroups
 * and by bigCount + smallCount when both are set.
 * @param {any} t
 * @param {any[]} groups
 * @returns {number}
 */
function reachableCount(t, groups) {
  const quals = Array.isArray(t?.qualifications) ? t.qualifications : [];
  let n = 0;
  for (const g of groups) {
    if (g && g.subjectId && quals.includes(g.subjectId) && !isDenied(t, g)) n++;
  }
  if (isNum(t?.maxGroups)) n = Math.min(n, Math.max(0, t.maxGroups));
  if (isNum(t?.bigCount) && isNum(t?.smallCount))
    n = Math.min(n, Math.max(0, t.bigCount + t.smallCount));
  return n;
}

/**
 * The ideal number of classes for each real teacher, never above what the
 * teacher can reach (see reachableCount):
 *  1. a typed `targetClasses` (capped at reach);
 *  2. a teacher whose role is "fill to cap" gets cap / (average periods per
 *     seat), capped at reach;
 *  3. the remaining seats (never below 0) are shared by everyone else in
 *     proportion to cap, water-filled: anyone whose share exceeds their reach
 *     gets exactly their reach and the rest is re-shared among the others.
 * A team-taught group is one seat per teacher it needs. Placeholder teachers,
 * teachers with no cap and teachers who can reach no group are left out.
 * @param {any} data
 * @returns {Map<string, number>}
 */
function idealClassCounts(data) {
  const out = new Map();
  const groups = (Array.isArray(data?.groups) ? data.groups : []).filter(isObj);
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

  const reach = new Map();
  const members = [];
  for (const t of teachers) {
    if (!isObj(t) || t.isPlaceholder) continue;
    if (!(effectiveCap(data, t) > 0)) continue;
    const r = reachableCount(t, groups);
    if (r <= 0) continue;
    reach.set(t.id, r);
    members.push(t);
  }

  const roleById = new Map(roles.map((r) => [r?.id, r]));
  let fixed = 0;
  let sharers = [];
  for (const t of members) {
    const r = reach.get(t.id);
    if (isNum(t.targetClasses) && t.targetClasses >= 0) {
      const ideal = Math.min(t.targetClasses, r);
      out.set(t.id, ideal);
      fixed += ideal;
    } else if (roleFillsToCap(roleById.get(t.roleId)) && avgPeriods > 0) {
      const ideal = Math.min(effectiveCap(data, t) / avgPeriods, r);
      out.set(t.id, ideal);
      fixed += ideal;
    } else {
      sharers.push(t);
    }
  }

  // Water-filling: share the rest by cap; anyone whose share is above their
  // reach takes exactly their reach and leaves the pool; repeat.
  let rest = Math.max(0, seats - fixed);
  for (;;) {
    const capSum = sharers.reduce((sum, t) => sum + effectiveCap(data, t), 0);
    const share = (t) =>
      capSum > 0 ? (rest * effectiveCap(data, t)) / capSum : 0;
    const capped = sharers.filter((t) => share(t) > reach.get(t.id));
    if (capped.length === 0) {
      for (const t of sharers) out.set(t.id, share(t));
      break;
    }
    for (const t of capped) {
      out.set(t.id, reach.get(t.id));
      rest = Math.max(0, rest - reach.get(t.id));
    }
    sharers = sharers.filter((t) => !capped.includes(t));
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
  // Null or non-object entries (a damaged save) are skipped, never read.
  const teachers = (Array.isArray(data?.teachers) ? data.teachers : []).filter(
    (t) => isObj(t) && !t.isPlaceholder,
  );
  const groups = (Array.isArray(data?.groups) ? data.groups : []).filter(isObj);
  const assignments = (
    Array.isArray(data?.assignments) ? data.assignments : []
  ).filter(isObj);
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
