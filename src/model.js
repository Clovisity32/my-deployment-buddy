// Builds a CPLEX-LP format model string from problem data and the enabled
// layers (see src/layers/registry.js). Pure function - no HiGHS/browser
// dependency - so it can be unit tested with plain Node and inspected
// row-by-row when a layer misbehaves.

import { getLayers } from "./layers/registry.js";
import { fairnessWeights, FAIRNESS_KEY_BY_LAYER } from "./fairness.js";

/**
 * @param {import('./data.js').default} data
 * @returns {{
 *   pairs: {teacherId:string, groupId:string}[],
 *   varNameByPair: Map<string,string>,
 *   pairByVarName: Map<string,{teacherId:string, groupId:string}>,
 *   constraints: {name:string, terms:{coef:number, varName:string}[], op:string, rhs:number}[],
 *   objectiveTerms: {coef:number, varName:string}[],
 *   extraBinaryVars: string[],
 *   lp: string,
 * }}
 */
function buildModel(data) {
  const layers = getLayers();
  const settingsById = new Map(
    (data.layerSettings || []).map((s) => [s.id, s]),
  );

  const isEnabled = (layer) => {
    const s = settingsById.get(layer.id);
    return s ? s.enabled !== false : true; // Unconfigured layers default to enabled.
  };

  const weightOf = (layerId) => {
    // The fairness layers and placeholder avoidance take their weight from the
    // Fairness emphasis (src/fairness.js), not from layerSettings.
    if (layerId === "placeholder") return fairnessWeights(data).placeholder;
    if (Object.hasOwn(FAIRNESS_KEY_BY_LAYER, layerId))
      return fairnessWeights(data)[FAIRNESS_KEY_BY_LAYER[layerId]];
    const layer = layers.find((l) => l.id === layerId);
    const s = settingsById.get(layerId);
    if (s && typeof s.weight === "number") return s.weight;
    return layer ? layer.defaultWeight : 0;
  };

  // 1. Start from every (teacher, group) combination...
  let pairs = [];
  for (const t of data.teachers) {
    for (const g of data.groups) {
      pairs.push({ teacherId: t.id, groupId: g.id });
    }
  }

  // 2. ...then let enabled layers narrow it (qualification removes unqualified
  //    pairs here, before any decision variable is created - this is what keeps
  //    the model small as more groups/teachers/layers are added).
  for (const layer of layers) {
    if (isEnabled(layer) && typeof layer.filterPairs === "function") {
      pairs = layer.filterPairs(data, pairs);
    }
  }

  // 3. Assign LP-safe variable names (real ids may contain characters an LP
  //    parser would choke on, e.g. leading digits or dashes read as minus).
  const varNameByPair = new Map();
  const pairByVarName = new Map();
  pairs.forEach((p, i) => {
    const varName = `v${i}`;
    varNameByPair.set(`${p.teacherId}|${p.groupId}`, varName);
    pairByVarName.set(varName, p);
  });

  const constraints = [];
  const extraBinaryVars = []; // Layer-declared 0/1 helper variables (not assignments).
  const objectiveByVar = new Map(); // varName -> summed coef. Multiple layers can
  // target the same variable's objective coefficient (e.g. placeholder.js and
  // classCount.js both touch a placeholder teacher's pairs) - a CPLEX-LP row
  // may not repeat a variable, so contributions must be summed, not appended.

  /** @type {import('./layers/registry.js').LayerBuildContext} */
  const ctx = {
    data,
    pairs,
    x(teacherId, groupId) {
      return varNameByPair.get(`${teacherId}|${groupId}`) || null;
    },
    hasVar(teacherId, groupId) {
      return varNameByPair.has(`${teacherId}|${groupId}`);
    },
    addConstraint(name, terms, op, rhs) {
      constraints.push({ name, terms: mergeTerms(terms), op, rhs });
    },
    addObjectiveTerm(coef, varName) {
      if (!coef || !varName) return;
      objectiveByVar.set(varName, (objectiveByVar.get(varName) || 0) + coef);
    },
    weight(layerId) {
      return weightOf(layerId);
    },
    declareBinary(name) {
      if (!extraBinaryVars.includes(name)) extraBinaryVars.push(name);
      return name;
    },
  };

  // 4. Every enabled layer (including qualification, whose build() is a no-op)
  //    adds its constraints/objective terms via ctx.
  for (const layer of layers) {
    if (isEnabled(layer)) {
      layer.build(ctx);
    }
  }

  const objectiveTerms = Array.from(objectiveByVar, ([varName, coef]) => ({
    coef,
    varName,
  })).filter((t) => t.coef !== 0);

  const lp = toLpString({
    varNames: [...pairByVarName.keys(), ...extraBinaryVars],
    constraints,
    objectiveTerms,
  });

  return {
    pairs,
    varNameByPair,
    pairByVarName,
    constraints,
    objectiveTerms,
    extraBinaryVars,
    lp,
  };
}

/**
 * Sums coefficients for any variable that appears more than once in a single
 * row, preserving first-seen order. A CPLEX-LP row must not repeat a
 * variable, so this must run before a constraint's terms are stored.
 */
function mergeTerms(terms) {
  const coefByVar = new Map();
  for (const { coef, varName } of terms) {
    coefByVar.set(varName, (coefByVar.get(varName) || 0) + coef);
  }
  return Array.from(coefByVar, ([varName, coef]) => ({ coef, varName })).filter(
    (t) => t.coef !== 0,
  );
}

/** Renders one "+coef varName" / "-coef varName" token for an LP row. */
function formatTerm(coef, varName) {
  const sign = coef < 0 ? "-" : "+";
  return ` ${sign} ${Math.abs(coef)} ${varName}`;
}

function opSymbol(op) {
  if (op === "=" || op === "<=" || op === ">=") return op;
  throw new Error(`Unknown constraint operator: ${op}`);
}

/**
 * Turns an arbitrary constraint name into a name safe for a CPLEX-LP row
 * label. Real ids in this project (e.g. group id "g-301") contain dashes,
 * which an LP reader parses as a minus operator inside a token - so a row
 * label like "coverage_g-301:" corrupts the whole row. Only alphanumerics
 * and underscores survive; everything else becomes "_". Row labels never
 * feed back into application logic (diagnose.js keeps its own index-based
 * link to model.constraints), so this only has to be safe, not reversible.
 */
function sanitizeIdentifier(name) {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

/**
 * Renders a CPLEX-LP format string for HiGHS. Every declared variable is
 * binary (0/1), matching the teacher-to-group assignment model.
 */
function toLpString({ varNames, constraints, objectiveTerms }) {
  const lines = [];

  lines.push("Minimize");
  lines.push(
    " obj:" +
      (objectiveTerms.length > 0
        ? objectiveTerms.map((t) => formatTerm(t.coef, t.varName)).join("")
        : " 0"),
  );

  lines.push("Subject To");
  if (constraints.length === 0) {
    lines.push(" c_none: 0 <= 0"); // Keep the LP well-formed with zero constraints.
  }
  const usedRowNames = new Set();
  for (const c of constraints) {
    let rowName = sanitizeIdentifier(c.name);
    if (usedRowNames.has(rowName)) {
      let suffix = 2;
      while (usedRowNames.has(`${rowName}_${suffix}`)) suffix += 1;
      rowName = `${rowName}_${suffix}`;
    }
    usedRowNames.add(rowName);

    const lhs =
      c.terms.length > 0
        ? c.terms.map((t) => formatTerm(t.coef, t.varName)).join("")
        : " 0";
    lines.push(` ${rowName}:${lhs} ${opSymbol(c.op)} ${c.rhs}`);
  }

  lines.push("Binary");
  for (const v of varNames) {
    lines.push(` ${v}`);
  }

  lines.push("End");
  return lines.join("\n");
}

export { buildModel, toLpString };
