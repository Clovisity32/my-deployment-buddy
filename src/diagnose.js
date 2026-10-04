// Turns "the solver failed" into plain language the HOD can act on.
//
// Two stages:
//  1. Pre-checks (instant, no solver call) - catch the common, easy-to-explain
//     cases: a group nobody is qualified for, or a subject block where total
//     demand simply exceeds what qualified teachers can supply.
//  2. Elastic re-solve (fallback) - if the pre-checks find nothing obvious,
//     relax every hard constraint with a heavily-penalised slack variable and
//     solve again. Whichever slacks come out non-zero are exactly the
//     constraints that couldn't be satisfied, which we can name in English.

import { getHighs } from "./solve.js";
import { effectiveCap, bigThreshold, graduatingSettings } from "./data.js";
import { isSet } from "./layers/groupCount.js";

/**
 * Fast, solver-free checks for the most common and clearest infeasibility
 * causes. Returns an array of plain-language strings; empty means "nothing
 * obvious found here - fall back to the elastic re-solve".
 * @param {import('./data.js').default} data
 * @param {ReturnType<import('./model.js').buildModel>} model
 * @returns {string[]}
 */
function preCheck(data, model) {
  const issues = [];
  const groupById = new Map(data.groups.map((g) => [g.id, g]));

  // 1. A group with zero qualified teachers shows up as an empty-terms
  //    coverage constraint (see coverage.js / qualification.js).
  for (const c of model.constraints) {
    if (c.name.startsWith("coverage_") && c.terms.length === 0) {
      const groupId = c.name.slice("coverage_".length);
      const g = groupById.get(groupId);
      issues.push(
        g
          ? `No teacher is qualified for "${g.label}" (${g.block}), or every qualified teacher is on a deny list for it. Add a qualified teacher, check a teacher's subject list isn't missing ${g.block}, or relax a deny rule.`
          : `No teacher is qualified for group "${groupId}".`,
      );
    }
  }
  if (issues.length > 0) return issues; // Fix these first - they make later checks noisy.

  // 2. Per-subject capacity: total periods a subject's groups need vs. total
  //    periods qualified teachers can give (ignoring caps used by other
  //    subjects, so this is a necessary-but-not-sufficient check - good
  //    enough to point at the right subject). A group with no matching
  //    subjects[] record (a legacy/custom group without a subjectId) falls
  //    back to being grouped by its raw `block` string instead, so it isn't
  //    silently skipped from this check.
  const subjects = Array.isArray(data.subjects) ? data.subjects : [];
  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  const groupsBySubjectId = new Map(); // subjectId -> groups[]
  const groupsByLegacyBlock = new Map(); // block -> groups[] (no matching subject record)
  for (const g of data.groups) {
    if (g.subjectId && subjectById.has(g.subjectId)) {
      if (!groupsBySubjectId.has(g.subjectId))
        groupsBySubjectId.set(g.subjectId, []);
      groupsBySubjectId.get(g.subjectId).push(g);
    } else {
      if (!groupsByLegacyBlock.has(g.block))
        groupsByLegacyBlock.set(g.block, []);
      groupsByLegacyBlock.get(g.block).push(g);
    }
  }

  for (const [subjectId, groupsForSubject] of groupsBySubjectId) {
    const subjectName = subjectById.get(subjectId).name;
    const demand = groupsForSubject.reduce(
      (sum, g) => sum + g.periods * g.teachersNeeded,
      0,
    );
    const capacity = data.teachers
      .filter(
        (t) =>
          Array.isArray(t.qualifications) &&
          t.qualifications.includes(subjectId),
      )
      .reduce((sum, t) => sum + effectiveCap(data, t), 0);
    if (demand > capacity) {
      issues.push(
        `${subjectName} needs ${demand} periods in total, but teachers qualified for ${subjectName} can give at most ${capacity}. Short by ${demand - capacity} period(s).`,
      );
    }
  }
  for (const [block, groupsForBlock] of groupsByLegacyBlock) {
    const demand = groupsForBlock.reduce(
      (sum, g) => sum + g.periods * g.teachersNeeded,
      0,
    );
    // These groups have no subjectId, so the qualification layer never
    // matches a teacher to them - capacity is necessarily 0. In practice
    // check #1 (a coverage constraint with zero terms) already catches this
    // before check #2 runs; this branch exists so the message is still
    // informative if that ever changes.
    const capacity = 0;
    if (demand > capacity) {
      issues.push(
        `${block} needs ${demand} periods in total, but teachers qualified for ${block} can give at most ${capacity}. Short by ${demand - capacity} period(s).`,
      );
    }
  }
  if (issues.length > 0) return issues;

  // 2b. A teacher's exact big/small count that exceeds how many such groups
  //     they are even eligible for (model.pairs is already qualification-
  //     filtered), or a big+small total above their own max-groups limit.
  const eligible = new Map(); // teacherId -> { big, small }
  const threshold = bigThreshold(data);
  for (const p of model.pairs) {
    const g = groupById.get(p.groupId);
    if (!g) continue;
    if (!eligible.has(p.teacherId))
      eligible.set(p.teacherId, { big: 0, small: 0 });
    eligible.get(p.teacherId)[g.periods >= threshold ? "big" : "small"]++;
  }
  for (const t of data.teachers) {
    const have = eligible.get(t.id) || { big: 0, small: 0 };
    if (isSet(t.bigCount) && t.bigCount > have.big)
      issues.push(
        `"${t.name}" is set to ${t.bigCount} big group(s) (${threshold}+ periods), but is only qualified for ${have.big}. Lower the number or add qualifications.`,
      );
    if (isSet(t.smallCount) && t.smallCount > have.small)
      issues.push(
        `"${t.name}" is set to ${t.smallCount} small group(s), but is only qualified for ${have.small}. Lower the number or add qualifications.`,
      );
    if (
      isSet(t.maxGroups) &&
      (t.bigCount ?? 0) + (t.smallCount ?? 0) > t.maxGroups
    )
      issues.push(
        `"${t.name}" has ${(t.bigCount ?? 0) + (t.smallCount ?? 0)} big and small group(s) set, which is more than their maximum of ${t.maxGroups} group(s).`,
      );
  }
  if (issues.length > 0) return issues;

  // 3. Overall: total demand across every group vs. total capacity across
  //    every teacher (catches an across-the-board overload the per-subject
  //    check can miss if periods are unevenly distributed).
  const totalDemand = data.groups.reduce(
    (sum, g) => sum + g.periods * g.teachersNeeded,
    0,
  );
  const totalCapacity = data.teachers.reduce(
    (sum, t) => sum + effectiveCap(data, t),
    0,
  );
  if (totalDemand > totalCapacity) {
    issues.push(
      `Overall, groups need ${totalDemand} periods but all teachers together can give ${totalCapacity}. Short by ${totalDemand - totalCapacity} period(s).`,
    );
  }

  return issues;
}

const HARD_PREFIXES = [
  "coverage_",
  "loadCap_",
  "groupCount_",
  "graduatingMax_",
  "pin_",
  "formTeacher_",
  "bandClash_",
];

function isHardConstraint(name) {
  return HARD_PREFIXES.some((p) => name.startsWith(p));
}

const ELASTIC_PENALTY = 100000; // Large relative to any realistic objective, so the
// solver only uses a slack when no slack-free solution exists.

/**
 * Builds a relaxed copy of `model` where every hard constraint can be
 * violated at a steep objective penalty, via extra continuous slack
 * variables (never declared Binary, so they default to continuous >= 0).
 * @param {ReturnType<import('./model.js').buildModel>} model
 * @returns {{lp:string, slackMeta: Map<string,{constraintName:string}>}}
 */
function buildElasticLp(model) {
  const lines = [];
  const slackMeta = new Map(); // slack var name -> { constraintName }
  const objectiveTerms = [...model.objectiveTerms];
  const constraintLines = [];
  let slackIndex = 0;

  for (const c of model.constraints) {
    const baseTerms = c.terms.map((t) => ({
      coef: t.coef,
      varName: t.varName,
    }));
    if (!isHardConstraint(c.name)) {
      constraintLines.push(renderRow(c.name, baseTerms, c.op, c.rhs));
      continue;
    }
    if (c.op === "=") {
      const sPos = `s${slackIndex++}`;
      const sNeg = `s${slackIndex++}`;
      slackMeta.set(sPos, { constraintName: c.name });
      slackMeta.set(sNeg, { constraintName: c.name });
      objectiveTerms.push({ coef: ELASTIC_PENALTY, varName: sPos });
      objectiveTerms.push({ coef: ELASTIC_PENALTY, varName: sNeg });
      constraintLines.push(
        renderRow(
          c.name,
          [
            ...baseTerms,
            { coef: 1, varName: sPos },
            { coef: -1, varName: sNeg },
          ],
          "=",
          c.rhs,
        ),
      );
    } else if (c.op === "<=") {
      const s = `s${slackIndex++}`;
      slackMeta.set(s, { constraintName: c.name });
      objectiveTerms.push({ coef: ELASTIC_PENALTY, varName: s });
      constraintLines.push(
        renderRow(
          c.name,
          [...baseTerms, { coef: -1, varName: s }],
          "<=",
          c.rhs,
        ),
      );
    } else {
      // '>=' - not used by any MVP layer, but handled for completeness.
      const s = `s${slackIndex++}`;
      slackMeta.set(s, { constraintName: c.name });
      objectiveTerms.push({ coef: ELASTIC_PENALTY, varName: s });
      constraintLines.push(
        renderRow(c.name, [...baseTerms, { coef: 1, varName: s }], ">=", c.rhs),
      );
    }
  }

  lines.push("Minimize");
  lines.push(
    " obj:" +
      objectiveTerms
        .map(
          (t) => ` ${t.coef < 0 ? "-" : "+"} ${Math.abs(t.coef)} ${t.varName}`,
        )
        .join(""),
  );
  lines.push("Subject To");
  lines.push(...constraintLines);
  lines.push("Binary");
  for (const v of model.varNameByPair.values()) lines.push(` ${v}`);
  for (const v of model.extraBinaryVars || []) lines.push(` ${v}`);
  // Slack variables are intentionally left out of Binary/Integer sections,
  // so HiGHS treats them as continuous with the LP-format default bounds
  // (0 to +infinity) - exactly what a one-directional relaxation needs.
  lines.push("End");

  return { lp: lines.join("\n"), slackMeta };
}

function renderRow(name, terms, op, rhs) {
  const safeName = name
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^(?![A-Za-z_])/, "_");
  const lhs =
    terms.length > 0
      ? terms
          .map(
            (t) =>
              ` ${t.coef < 0 ? "-" : "+"} ${Math.abs(t.coef)} ${t.varName}`,
          )
          .join("")
      : " 0";
  return ` ${safeName}:${lhs} ${op} ${rhs}`;
}

/**
 * For an uncovered group: who is qualified, and how much room each has left
 * once locked assignments are counted - usually the real reason it can't be
 * covered. Returns "" when there is nothing useful to add.
 */
function describeQualifiedRoom(data, group) {
  if (!group.subjectId) return "";
  const groupById = new Map(data.groups.map((g) => [g.id, g]));
  const qualified = data.teachers.filter(
    (t) =>
      Array.isArray(t.qualifications) &&
      t.qualifications.includes(group.subjectId),
  );
  if (qualified.length === 0) return "";
  const parts = qualified.map((t) => {
    const cap = effectiveCap(data, t);
    const locked = (data.assignments || [])
      .filter((a) => a.teacherId === t.id && a.locked)
      .reduce((sum, a) => sum + (groupById.get(a.groupId)?.periods || 0), 0);
    return `${t.name} (cap ${cap}, ${locked} locked, room ${Math.max(0, cap - locked)})`;
  });
  return ` Qualified teachers and their room under the cap once locked assignments are counted: ${parts.join("; ")}. Unlock some assignments or raise a cap to free room.`;
}

/** Turns a violated constraint name into one plain-language sentence. */
function explainConstraint(constraintName, data, slackValue) {
  const groupById = new Map(data.groups.map((g) => [g.id, g]));
  const teacherById = new Map(data.teachers.map((t) => [t.id, t]));
  const rounded = Math.round(slackValue * 100) / 100;

  if (constraintName.startsWith("coverage_")) {
    const groupId = constraintName.slice("coverage_".length);
    const g = groupById.get(groupId);
    return g
      ? `"${g.label}" is short ${rounded} teacher assignment(s) - it needs ${g.teachersNeeded}, but the other constraints leave it uncovered.${describeQualifiedRoom(data, g)}`
      : `Group "${groupId}" could not be fully covered.`;
  }
  if (constraintName.startsWith("loadCap_")) {
    const teacherId = constraintName.slice("loadCap_".length);
    const t = teacherById.get(teacherId);
    return t
      ? `"${t.name}" would need ${rounded} period(s) more than their cap of ${effectiveCap(data, t)} to satisfy the other requirements (often caused by a locked assignment).`
      : `Teacher "${teacherId}"'s load cap could not be respected.`;
  }
  if (constraintName.startsWith("groupCount_")) {
    // Name is "groupCount_<max|big|small>_<teacherId>".
    const rest = constraintName.slice("groupCount_".length);
    const kind = ["max", "big", "small"].find((k) => rest.startsWith(`${k}_`));
    const t = kind && teacherById.get(rest.slice(kind.length + 1));
    if (!t) return "A teacher's group-count setting could not be respected.";
    if (kind === "max")
      return `"${t.name}" would need ${rounded} group(s) more than their maximum of ${t.maxGroups} to satisfy the other requirements (often caused by a locked assignment).`;
    const n = kind === "big" ? t.bigCount : t.smallCount;
    const label =
      kind === "big" ? `big (${bigThreshold(data)}+ periods)` : "small";
    return `"${t.name}" is set to exactly ${n} ${label} group(s), but the other requirements can't allow that. Change the number or clear it.`;
  }
  if (constraintName.startsWith("pin_")) {
    // Name is "pin_<teacherId>_<groupId>". Ids may themselves contain
    // underscores, so find the split point by matching a known teacher id
    // prefix rather than guessing from the separator.
    const rest = constraintName.slice("pin_".length);
    let match = null;
    for (const t of data.teachers) {
      const prefix = `${t.id}_`;
      if (rest.startsWith(prefix)) {
        const g = groupById.get(rest.slice(prefix.length));
        if (g) {
          match = { t, g };
          break;
        }
      }
    }
    return match
      ? `Locking "${match.t.name}" to "${match.g.label}" conflicts with another hard requirement (such as their load cap or another lock).`
      : `A locked assignment (${rest}) conflicts with another hard requirement, such as a load cap or another lock.`;
  }
  if (constraintName.startsWith("bandClash_")) {
    // Name is "bandClash_<bandId>_<teacherId>". Ids may themselves contain
    // underscores, so find the split point by matching a known band id
    // prefix rather than guessing from the separator (same technique as
    // pin_ above).
    const rest = constraintName.slice("bandClash_".length);
    const bands = Array.isArray(data.bands) ? data.bands : [];
    let match = null;
    for (const band of bands) {
      const prefix = `${band.id}_`;
      if (rest.startsWith(prefix)) {
        const t = teacherById.get(rest.slice(prefix.length));
        if (t) {
          match = { band, t };
          break;
        }
      }
    }
    return match
      ? `${match.t.name} would need to be in two places at once for band "${match.band.name}" - only one group per teacher is allowed within a band.`
      : `A teacher would need to be in two places at once within a band (${rest}) - only one group per teacher is allowed within a band.`;
  }
  if (constraintName.startsWith("formTeacher_")) {
    // Name is "formTeacher_<classId>"; the id may contain underscores, so
    // match it against the real class list.
    const classId = constraintName.slice("formTeacher_".length);
    const c = (data.classes || []).find((x) => x.id === classId);
    const t = c && teacherById.get(c.formTeacherId);
    return c && t
      ? `"${t.name}" is form teacher of Sec ${c.level} ${c.name} but can't be given any group of that class - they may not be qualified for them, may be on a deny list for them, or the other requirements leave no room. Change the form teacher or relax a rule.`
      : "A form teacher could not be given any group of their own class. Change the form teacher or relax a rule.";
  }
  if (constraintName.startsWith("graduatingMax_")) {
    const t = teacherById.get(constraintName.slice("graduatingMax_".length));
    const { max } = graduatingSettings(data);
    return t
      ? `"${t.name}" would need ${rounded} more graduating group(s) than the maximum of ${max} to satisfy the other requirements (often caused by locked assignments). Unlock one, or move a graduating class to someone else.`
      : "A teacher's maximum of graduating groups could not be respected.";
  }
  return `Requirement "${constraintName}" could not be satisfied.`;
}

/**
 * Full infeasibility diagnosis: pre-checks first, then an elastic re-solve
 * if nothing obvious was found. Never throws for an infeasible model.
 * @param {import('./data.js').default} data
 * @param {ReturnType<import('./model.js').buildModel>} model
 * @returns {Promise<{method:'precheck'|'elastic'|'none', issues:string[]}>}
 */
async function diagnoseInfeasibility(data, model) {
  const preIssues = preCheck(data, model);
  if (preIssues.length > 0) {
    return { method: "precheck", issues: preIssues };
  }

  const highs = await getHighs();
  const { lp, slackMeta } = buildElasticLp(model);
  const result = highs.solve(lp, {
    output_flag: false,
    random_seed: 1,
    time_limit: 120,
  });

  if (result.Status !== "Optimal") {
    return {
      method: "elastic",
      issues: [
        "This deployment could not be diagnosed automatically. Try relaxing one constraint at a time (e.g. raise a load cap) and re-solve.",
      ],
    };
  }

  const issues = [];
  const reportedConstraints = new Set(); // An equality constraint has two slacks
  // (sPos/sNeg) mapped to the same constraintName - report it at most once.
  for (const [slackVar, meta] of slackMeta) {
    const col = result.Columns[slackVar];
    if (
      col &&
      col.Primal > 1e-6 &&
      !reportedConstraints.has(meta.constraintName)
    ) {
      reportedConstraints.add(meta.constraintName);
      issues.push(explainConstraint(meta.constraintName, data, col.Primal));
    }
  }

  if (issues.length === 0) {
    // Elastic solve used no slack, so the original model wasn't actually
    // infeasible - most likely it hit the solver's time limit instead.
    issues.push(
      "No solution was found within the time limit. Try again, or simplify the problem (fewer groups/teachers, or disable a soft layer) and re-solve.",
    );
  }

  return { method: "elastic", issues };
}

export { preCheck, diagnoseInfeasibility, buildElasticLp, explainConstraint };
