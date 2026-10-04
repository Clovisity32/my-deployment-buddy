// Layer registry: the ordered list of constraint/objective "layers" that
// build the optimisation model. Every layer shares the same contract so
// adding a new one never requires touching existing layers, model.js, or
// the UI wiring - see CLAUDE.md "How to add a layer".
//
// Layer contract:
//   {
//     id: string,                 // stable id, used as constraint-name prefix
//     name: string,                // human-readable label for the UI
//     kind: 'hard' | 'soft',
//     defaultWeight: number,       // only meaningful for soft layers
//     describe(data): string,      // plain-language sentence for the Layers tab
//     build(ctx): void,            // adds constraints/objective terms via ctx
//     filterPairs(data, pairs): [] // OPTIONAL - narrows candidate (teacher, group)
//                                  // pairs *before* variables are created. Only
//                                  // needed by a layer that removes pairs entirely
//                                  // (qualification is the only current example).
//   }
//
// ctx (passed to build()) exposes:
//   ctx.data                                given problem data (teachers, groups, assignments, layerSettings)
//   ctx.pairs                                list of {teacherId, groupId} pairs that have a decision variable
//   ctx.x(teacherId, groupId)                variable name for that pair, or null if no variable exists
//   ctx.hasVar(teacherId, groupId)           whether a variable exists for that pair
//   ctx.addConstraint(name, terms, op, rhs)  terms: [{coef, varName}]; op: '=' | '<=' | '>='
//   ctx.addObjectiveTerm(coef, varName)      adds coef * varName to the (minimised) objective
//   ctx.declareBinary(name)                  declares an extra 0/1 helper variable (returns name);
//                                            any other variable used in a row is continuous and >= 0
//   ctx.weight(layerId)                      resolves the configured weight for a layer (falls back to defaultWeight)

import { coverageLayer } from "./coverage.js";
import { qualificationLayer } from "./qualification.js";
import { denyLayer } from "./deny.js";
import { loadCapLayer } from "./loadCap.js";
import { groupCountLayer } from "./groupCount.js";
import { pinLayer } from "./pin.js";
import { bandClashLayer } from "./bandClash.js";
import { stableLayer } from "./stable.js";
import { placeholderLayer } from "./placeholder.js";
import { balanceLayer } from "./balance.js";
import { mixLayer } from "./mix.js";
import { prepsLayer } from "./preps.js";

/** Layers in build order. Order matters only for readability of the LP output. */
const LAYERS = [
  coverageLayer,
  qualificationLayer,
  denyLayer,
  loadCapLayer,
  groupCountLayer,
  pinLayer,
  bandClashLayer,
  balanceLayer,
  mixLayer,
  prepsLayer,
  stableLayer,
  placeholderLayer,
];

/** @returns {typeof LAYERS} all registered layers, in build order */
function getLayers() {
  return LAYERS;
}

/** @param {string} id @returns {typeof LAYERS[number] | undefined} */
function getLayer(id) {
  return LAYERS.find((l) => l.id === id);
}

export { getLayers, getLayer };
