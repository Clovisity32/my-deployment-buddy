// Loads HiGHS (WASM, vendored locally in ./vendor/highs so it works fully
// offline at school) and solves a built model (see model.js), returning
// parsed assignments. The vendored .wasm/.mjs are the same in Node (used by
// tests) and in the browser - no bundler, no CDN.
//
// HiGHS's WASM build is single-threaded and each solve() call creates a
// fresh native instance (see node_modules/highs/README.md), so identical
// input always produces identical output - so a re-solve is reproducible
// (same model, same result) rather than a different layout each time; locks
// are what keep chosen assignments in place.

import loadHighs from "./vendor/highs/highs.mjs";

let highsPromise = null;

/** Lazily loads and caches the HiGHS WASM instance for this page/process. */
function getHighs() {
  if (!highsPromise) {
    highsPromise = loadHighs();
  }
  return highsPromise;
}

const DEFAULT_OPTIONS = {
  output_flag: false,
  random_seed: 1,
  time_limit: 120, // seconds - the real school problem takes ~20s on a fast machine, so leave headroom for the school laptop
};

/**
 * What a HiGHS status means for the app. A run that hit the time limit is
 * neither optimal (its assignment is never accepted) nor infeasible (the
 * hard constraints may well be satisfiable), so it gets its own flag.
 * @param {unknown} status
 * @returns {{optimal:boolean, timedOut:boolean}}
 */
function classifyStatus(status) {
  return {
    optimal: status === "Optimal",
    timedOut: status === "Time limit reached",
  };
}

/**
 * Solves a built model and returns the resulting assignments.
 * @param {import('./model.js').buildModel extends (...a:any)=>infer R ? R : never} model
 * @param {object} [options] extra/overriding HiGHS options
 * @returns {Promise<{status:string, optimal:boolean, timedOut:boolean, assignments:{teacherId:string, groupId:string}[], objectiveValue:number|null, raw:any}>}
 */
async function solveModel(model, options = {}) {
  const highs = await getHighs();
  const result = highs.solve(model.lp, { ...DEFAULT_OPTIONS, ...options });

  const { optimal, timedOut } = classifyStatus(result.Status);
  const assignments = [];
  if (optimal) {
    for (const [varName, pair] of model.pairByVarName) {
      const col = result.Columns[varName];
      if (col && col.Primal > 0.5) {
        assignments.push({ teacherId: pair.teacherId, groupId: pair.groupId });
      }
    }
  }

  return {
    status: result.Status,
    optimal,
    timedOut,
    assignments,
    objectiveValue:
      typeof result.ObjectiveValue === "number" ? result.ObjectiveValue : null,
    raw: result,
  };
}

export { solveModel, classifyStatus, getHighs, DEFAULT_OPTIONS };
