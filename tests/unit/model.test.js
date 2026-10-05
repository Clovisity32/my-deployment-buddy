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

test("placeholder layer only adds objective terms when a placeholder teacher exists", () => {
  const data = fixture();
  // Isolate from the soft fairness layers (each adds its own objective terms).
  data.layerSettings = ["classCount", "mix", "preps", "graduatingSpread"].map(
    (id) => ({
      id,
      enabled: false,
      weight: 0,
    }),
  );
  const withoutPlaceholder = buildModel(data);
  assert.equal(withoutPlaceholder.objectiveTerms.length, 0); // nothing else is soft here

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
  // Placeholder avoidance is 10x the largest fairness weight (256) = 2560.
  const t4Term = withPlaceholder.objectiveTerms.find(
    (t) => t.varName === t4Var,
  );
  assert.equal(t4Term && t4Term.coef, 2560);
});

test("fairness layer weights come from the Fairness emphasis, not from layerSettings", () => {
  const data = fixture();
  data.settings = {
    fairness: {
      preset: "custom",
      levels: { classCount: 1, mix: 1, preps: 1, graduating: 1 },
    },
  };
  data.layerSettings = [{ id: "classCount", enabled: true, weight: 999 }];
  const model = buildModel(data);
  const near = model.objectiveTerms.find((t) =>
    t.varName.startsWith("cc_near_"),
  );
  assert.ok(near, "expected a classCount near-deviation term");
  assert.equal(near.coef, 1); // level 1 -> weight 1, the saved 999 is ignored
  const far = model.objectiveTerms.find((t) => t.varName.startsWith("cc_far_"));
  assert.ok(far, "expected a classCount far-deviation term");
  assert.equal(far.coef, 2); // each class beyond the first costs double
});

test("mix, preps and graduatingSpread weights also come from the Fairness emphasis", () => {
  // Two teachers qualified for everything; big (12) and small (6) groups for
  // mix, two subjects for preps, three Sec 4 groups (> prefer of 2) for graduating.
  const g = (id, subjectId, level, periods) => ({
    id,
    level,
    block: subjectId,
    label: id,
    periods,
    band: null,
    bandId: null,
    teachersNeeded: 1,
    subjectId,
  });
  const data = {
    roles: [{ id: "r", name: "R", maxPeriods: null }],
    teachers: ["a", "b"].map((id) => ({
      id,
      name: id,
      roleId: "r",
      capOverride: 100,
      qualifications: ["A", "B"],
    })),
    groups: [
      g("g1", "A", 4, 12),
      g("g2", "B", 4, 6),
      g("g3", "A", 4, 6),
      g("g4", "B", 3, 12),
    ],
    assignments: [],
    settings: {
      fairness: {
        preset: "custom",
        levels: { classCount: 1, mix: 3, preps: 2, graduating: 4 },
      },
    },
    layerSettings: ["mix", "preps", "graduatingSpread"].map((id) => ({
      id,
      enabled: true,
      weight: 999,
    })),
  };
  const model = buildModel(data);
  const coefs = (prefix) =>
    model.objectiveTerms
      .filter((t) => t.varName.startsWith(prefix))
      .map((t) => t.coef);
  const all = (prefix, want) => {
    const c = coefs(prefix);
    assert.ok(c.length > 0, `expected ${prefix} objective terms`);
    assert.ok(
      c.every((x) => x === want),
      `${prefix} coefficients ${c} should all be ${want}`,
    );
  };
  all("mix_dev_", 16); // level 3 -> 4^2
  all("prep_", 4); // level 2 -> 4^1
  all("grad_over_", 64); // level 4 -> 4^3
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
