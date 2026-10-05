import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, toLpString } from "../../src/model.js";

// Fixture: 3 teachers, 4 groups (including one co-taught group and one group
// nobody is qualified for), mirroring the shapes seen in the real deployment
// sheet (single-subject teachers, a dual-subject teacher, a co-taught group).
// Schema v2: teachers carry roleId/capOverride/qualifications (subject ids)
// instead of maxPeriods/subjects; groups carry subjectId instead of relying
// on `block` for qualification matching (block is kept for display).
function fixture() {
  return {
    roles: [{ id: "role1", name: "Role 1", maxPeriods: null }],
    teachers: [
      {
        id: "t1",
        name: "Amy",
        roleId: "role1",
        capOverride: 8,
        qualifications: ["chem"],
      },
      {
        id: "t2",
        name: "Ben",
        roleId: "role1",
        capOverride: 8,
        qualifications: ["phy"],
      },
      {
        id: "t3",
        name: "Cara",
        roleId: "role1",
        capOverride: 10,
        qualifications: ["chem", "phy"],
      },
    ],
    groups: [
      {
        id: "g1",
        level: 3,
        block: "Chem",
        label: "G1 Chem",
        periods: 4,
        band: null,
        teachersNeeded: 1,
        subjectId: "chem",
      },
      {
        id: "g2",
        level: 3,
        block: "Phy",
        label: "G2 Phy",
        periods: 4,
        band: null,
        teachersNeeded: 1,
        subjectId: "phy",
      },
      {
        id: "g3",
        level: 3,
        block: "Chem",
        label: "G3 Chem (co-taught)",
        periods: 4,
        band: null,
        teachersNeeded: 2,
        subjectId: "chem",
      },
      {
        id: "g4",
        level: 3,
        block: "Bio",
        label: "G4 Bio (nobody qualified)",
        periods: 4,
        band: null,
        teachersNeeded: 1,
        subjectId: "bio",
      },
    ],
    assignments: [
      { teacherId: "t1", groupId: "g1", locked: false },
      { teacherId: "t3", groupId: "g3", locked: true },
    ],
  };
}

test("qualification filters out unqualified (teacher, group) pairs before variables are created", () => {
  const model = buildModel(fixture());
  const pairKeys = new Set(
    model.pairs.map((p) => `${p.teacherId}|${p.groupId}`),
  );
  assert.equal(pairKeys.size, 6); // t1-g1, t1-g3, t2-g2, t3-g1, t3-g2, t3-g3
  assert.ok(pairKeys.has("t1|g1"));
  assert.ok(pairKeys.has("t1|g3"));
  assert.ok(pairKeys.has("t2|g2"));
  assert.ok(pairKeys.has("t3|g1"));
  assert.ok(pairKeys.has("t3|g2"));
  assert.ok(pairKeys.has("t3|g3"));
  // Never qualified: t1-g2, t1-g4, t2-g1, t2-g3, t2-g4, t3-g4.
  assert.ok(!pairKeys.has("t1|g2"));
  assert.ok(!pairKeys.has("t2|g1"));
  assert.ok(!pairKeys.has("t3|g4"));
});

test("coverage requires each group's variables to sum to its teachersNeeded", () => {
  const model = buildModel(fixture());
  const byName = new Map(model.constraints.map((c) => [c.name, c]));

  assert.equal(byName.get("coverage_g1").op, "=");
  assert.equal(byName.get("coverage_g1").rhs, 1);
  assert.equal(byName.get("coverage_g1").terms.length, 2); // t1, t3

  assert.equal(byName.get("coverage_g3").rhs, 2); // co-taught
  assert.equal(byName.get("coverage_g3").terms.length, 2); // t1, t3

  // g4: nobody qualified -> an empty-terms constraint (structurally infeasible,
  // caught by diagnose.js pre-checks before ever calling the solver).
  assert.equal(byName.get("coverage_g4").terms.length, 0);
  assert.equal(byName.get("coverage_g4").rhs, 1);
});

test("load cap sums periods * assignment <= teacher maxPeriods, only for teachers with a qualified pair", () => {
  const model = buildModel(fixture());
  const byName = new Map(model.constraints.map((c) => [c.name, c]));

  assert.equal(byName.get("loadCap_t1").terms.length, 2); // g1, g3
  assert.equal(byName.get("loadCap_t1").rhs, 8);
  assert.equal(
    byName.get("loadCap_t1").terms.every((t) => t.coef === 4),
    true,
  );

  assert.equal(byName.get("loadCap_t2").terms.length, 1); // g2
  assert.equal(byName.get("loadCap_t3").terms.length, 3); // g1, g2, g3
});

test("locked assignments get a pin constraint fixing the variable to 1", () => {
  const model = buildModel(fixture());
  const pin = model.constraints.find((c) => c.name === "pin_t3_g3");
  assert.ok(pin, "expected a pin constraint for the locked t3/g3 assignment");
  assert.equal(pin.op, "=");
  assert.equal(pin.rhs, 1);
  assert.equal(pin.terms.length, 1);
  assert.equal(pin.terms[0].varName, model.varNameByPair.get("t3|g3"));

  // The unlocked t1/g1 assignment should NOT get a pin constraint.
  assert.equal(
    model.constraints.some((c) => c.name === "pin_t1_g1"),
    false,
  );
});

test("stable layer rewards keeping current assignments and penalises new ones", () => {
  const model = buildModel(fixture());
  const byVar = new Map(model.objectiveTerms.map((t) => [t.varName, t.coef]));

  const kept1 = byVar.get(model.varNameByPair.get("t1|g1"));
  const kept2 = byVar.get(model.varNameByPair.get("t3|g3"));
  const notCurrent = byVar.get(model.varNameByPair.get("t2|g2"));

  assert.equal(kept1, -5); // default stable weight
  assert.equal(kept2, -5);
  assert.equal(notCurrent, 5);
});

test("placeholder layer only adds objective terms when a placeholder teacher exists", () => {
  const data = fixture();
  // Isolate from the soft balance layers (on by default, each adds its own
  // objective terms).
  data.layerSettings = [
    "balance",
    "mix",
    "preps",
    "classCount",
    "graduatingSpread",
  ].map((id) => ({
    id,
    enabled: false,
    weight: 0,
  }));
  const withoutPlaceholder = buildModel(data);
  assert.equal(
    withoutPlaceholder.objectiveTerms.length,
    withoutPlaceholder.pairs.length,
  ); // only stable's terms

  data.teachers.push({
    id: "t4",
    name: "New Teacher",
    roleId: "role1",
    capOverride: 10,
    qualifications: ["chem"],
    isPlaceholder: true,
  });
  const withPlaceholder = buildModel(data);
  const t4Var = withPlaceholder.varNameByPair.get("t4|g1");
  // t4/g1 isn't in the current deployment, so stable.js also penalises it
  // (+5); model.js sums same-variable objective contributions into one LP
  // term, so the combined coefficient is 5 (stable) + 2560 (placeholder: 10x the
  // largest fairness weight, from the Fairness setting) = 2565.
  const t4Term = withPlaceholder.objectiveTerms.find(
    (t) => t.varName === t4Var && t.coef === 2565,
  );
  assert.ok(
    t4Term,
    "expected a combined +2565 penalty term for the placeholder teacher on g1",
  );
});

test("a disabled layer contributes no constraints", () => {
  const data = fixture();
  data.layerSettings = [{ id: "loadCap", enabled: false, weight: 0 }];
  const model = buildModel(data);
  assert.equal(
    model.constraints.some((c) => c.name.startsWith("loadCap_")),
    false,
  );
  // Coverage (still enabled by default) should be unaffected.
  assert.ok(model.constraints.some((c) => c.name === "coverage_g1"));
});

test("a custom weight override changes the objective coefficient", () => {
  const data = fixture();
  data.layerSettings = [{ id: "stable", enabled: true, weight: 100 }];
  const model = buildModel(data);
  const term = model.objectiveTerms.find(
    (t) => t.varName === model.varNameByPair.get("t1|g1"),
  );
  assert.equal(term.coef, -100);
});

test("the generated LP text is well-formed CPLEX-LP", () => {
  const model = buildModel(fixture());
  assert.match(model.lp, /^Minimize\n/);
  assert.match(model.lp, /\nSubject To\n/);
  assert.match(model.lp, /\nBinary\n/);
  assert.match(model.lp, /\nEnd$/);
  // Every declared variable appears in the Binary section exactly once.
  const binaryLines = model.lp
    .split("Binary\n")[1]
    .split("\nEnd")[0]
    .split("\n");
  assert.equal(
    binaryLines.length,
    model.pairs.length + model.extraBinaryVars.length,
  );
});

test("toLpString() renders a small hand-built model exactly", () => {
  const lp = toLpString({
    varNames: ["v0", "v1"],
    constraints: [
      {
        name: "c1",
        terms: [
          { coef: 1, varName: "v0" },
          { coef: 1, varName: "v1" },
        ],
        op: "=",
        rhs: 1,
      },
    ],
    objectiveTerms: [
      { coef: -5, varName: "v0" },
      { coef: 2, varName: "v1" },
    ],
  });
  assert.equal(
    lp,
    [
      "Minimize",
      " obj: - 5 v0 + 2 v1",
      "Subject To",
      " c1: + 1 v0 + 1 v1 = 1",
      "Binary",
      " v0",
      " v1",
      "End",
    ].join("\n"),
  );
});
