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
          ? `No teacher is qualified for "${g.label}" (${g.block}). Add a qualified teacher, or a teacher's subject list is missing ${g.block}.`
          : `No teacher is qualified for group "${groupId}".`,
      );
    }
  }
  if (issues.length > 0) return issues; // Fix these first - they make later checks noisy.

  // 2. Per-subject-block capacity: total periods the block's groups need vs.
  //    total periods qualified teachers can give (ignoring caps from other
  //    blocks, so this is a necessary-but-not-sufficient check - good enough
  //    to point at the right subject).
  const blocks = new Set(data.groups.map((g) => g.block));
  for (const block of blocks) {
    const demand = data.groups
      .filter((g) => g.block === block)
      .reduce((sum, g) => sum + g.periods * g.teachersNeeded, 0);
    const capacity = data.teachers
      .filter((t) => Array.isArray(t.subjects) && t.subjects.includes(block))
      .reduce((sum, t) => sum + t.maxPeriods, 0);
    if (demand > capacity) {
      issues.push(
        `${block} needs ${demand} periods in total, but teachers qualified for ${block} can give at most ${capacity}. Short by ${demand - capacity} period(s).`,
      );
    }
  }
  if (issues.length > 0) return issues;

  // 3. Overall: total demand across every group vs. total capacity across
  //    every teacher (catches an across-the-board overload the per-block
  //    check can miss if periods are unevenly distributed).
  const totalDemand = data.groups.reduce(
    (sum, g) => sum + g.periods * g.teachersNeeded,
    0,
  );
  const totalCapacity = data.teachers.reduce((sum, t) => sum + t.maxPeriods, 0);
  if (totalDemand > totalCapacity) {
    issues.push(
      `Overall, groups need ${totalDemand} periods but all teachers together can give ${totalCapacity}. Short by ${totalDemand - totalCapacity} period(s).`,
    );
  }

  return issues;
}

const HARD_PREFIXES = ["coverage_", "loadCap_", "pin_"];

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

/** Turns a violated constraint name into one plain-language sentence. */
function explainConstraint(constraintName, data, slackValue) {
  const groupById = new Map(data.groups.map((g) => [g.id, g]));
  const teacherById = new Map(data.teachers.map((t) => [t.id, t]));
  const rounded = Math.round(slackValue * 100) / 100;

  if (constraintName.startsWith("coverage_")) {
    const groupId = constraintName.slice("coverage_".length);
    const g = groupById.get(groupId);
    return g
      ? `"${g.label}" is short ${rounded} teacher assignment(s) - it needs ${g.teachersNeeded}, but the other constraints leave it uncovered.`
      : `Group "${groupId}" could not be fully covered.`;
  }
  if (constraintName.startsWith("loadCap_")) {
    const teacherId = constraintName.slice("loadCap_".length);
    const t = teacherById.get(teacherId);
    return t
      ? `"${t.name}" would need ${rounded} period(s) more than their cap of ${t.maxPeriods} to satisfy the other requirements (often caused by a locked assignment).`
      : `Teacher "${teacherId}"'s load cap could not be respected.`;
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
    time_limit: 30,
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
