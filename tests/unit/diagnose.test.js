import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../../src/model.js";
import { solveModel } from "../../src/solve.js";
import {
  preCheck,
  diagnoseInfeasibility,
  explainConstraint,
} from "../../src/diagnose.js";

test("preCheck() names a group with no qualified teacher", () => {
  const data = {
    teachers: [{ id: "t1", name: "Amy", maxPeriods: 20, subjects: ["Chem"] }],
    groups: [
      {
        id: "g1",
        level: 3,
        block: "Bio",
        label: "3G1 Bio",
        periods: 4,
        band: null,
        teachersNeeded: 1,
      },
    ],
    assignments: [],
  };
  const model = buildModel(data);
  const issues = preCheck(data, model);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /3G1 Bio/);
  assert.match(issues[0], /Bio/);
});

test("preCheck() flags a subject block that needs more periods than qualified teachers can give", () => {
  const data = {
    teachers: [{ id: "t1", name: "Amy", maxPeriods: 10, subjects: ["Chem"] }],
    groups: [
      {
        id: "g1",
        level: 3,
        block: "Chem",
        label: "G1 Chem",
        periods: 6,
        band: null,
        teachersNeeded: 1,
      },
      {
        id: "g2",
        level: 3,
        block: "Chem",
        label: "G2 Chem",
        periods: 6,
        band: null,
        teachersNeeded: 1,
      },
    ],
    assignments: [],
  };
  const model = buildModel(data);
  const issues = preCheck(data, model);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /Chem needs 12 periods/);
  assert.match(issues[0], /at most 10/);
});

test("preCheck() catches an overall overload that per-block capacity double-counts away", () => {
  // A dual-subject teacher's maxPeriods is counted in full for BOTH blocks'
  // per-block capacity, so per-block checks alone can miss a real overload.
  const data = {
    teachers: [
      { id: "t1", name: "Amy", maxPeriods: 8, subjects: ["Chem", "Phy"] },
    ],
    groups: [
      {
        id: "g1",
        level: 3,
        block: "Chem",
        label: "G1 Chem",
        periods: 6,
        band: null,
        teachersNeeded: 1,
      },
      {
        id: "g2",
        level: 3,
        block: "Phy",
        label: "G2 Phy",
        periods: 6,
        band: null,
        teachersNeeded: 1,
      },
    ],
    assignments: [],
  };
  const model = buildModel(data);
  const issues = preCheck(data, model);
  assert.equal(issues.length, 1);
  assert.match(
    issues[0],
    /Overall, groups need 12 periods but all teachers together can give 8/,
  );
});

test("preCheck() finds nothing wrong with a feasible model", () => {
  const data = {
    teachers: [{ id: "t1", name: "Amy", maxPeriods: 20, subjects: ["Chem"] }],
    groups: [
      {
        id: "g1",
        level: 3,
        block: "Chem",
        label: "G1 Chem",
        periods: 4,
        band: null,
        teachersNeeded: 1,
      },
    ],
    assignments: [],
  };
  assert.deepEqual(preCheck(data, buildModel(data)), []);
});

test("explainConstraint() renders a plain-language sentence for each hard-layer prefix", () => {
  const data = {
    teachers: [{ id: "t1", name: "Amy", maxPeriods: 20, subjects: ["Chem"] }],
    groups: [
      {
        id: "g1",
        level: 3,
        block: "Chem",
        label: "G1 Chem",
        periods: 4,
        band: null,
        teachersNeeded: 1,
      },
    ],
  };
  assert.match(explainConstraint("coverage_g1", data, 1), /"G1 Chem"/);
  assert.match(explainConstraint("loadCap_t1", data, 2), /"Amy"/);
  assert.match(explainConstraint("loadCap_t1", data, 2), /cap of 20/);
  assert.match(
    explainConstraint("pin_t1_g1", data, 1),
    /Locking "Amy" to "G1 Chem"/,
  );
  assert.match(
    explainConstraint("pin_unknownTeacher_g1", data, 1),
    /A locked assignment/,
  );
  assert.match(
    explainConstraint("unknown_thing", data, 1),
    /could not be satisfied/,
  );
});

test("diagnoseInfeasibility() falls back to an elastic re-solve for a lock-vs-load-cap conflict aggregate checks would miss", async () => {
  const data = {
    teachers: [
      { id: "t1", name: "Amy", maxPeriods: 8, subjects: ["Chem"] },
      { id: "t2", name: "Ben", maxPeriods: 8, subjects: ["Chem"] }, // spare capacity - aggregate checks pass
    ],
    groups: [
      {
        id: "gA",
        level: 3,
        block: "Chem",
        label: "Group A",
        periods: 6,
        band: null,
        teachersNeeded: 1,
      },
      {
        id: "gB",
        level: 3,
        block: "Chem",
        label: "Group B",
        periods: 6,
        band: null,
        teachersNeeded: 1,
      },
    ],
    // Both locked onto the same teacher: 6 + 6 = 12 periods > Amy's cap of 8.
    assignments: [
      { teacherId: "t1", groupId: "gA", locked: true },
      { teacherId: "t1", groupId: "gB", locked: true },
    ],
  };
  const model = buildModel(data);

  const solved = await solveModel(model);
  assert.notEqual(solved.status, "Optimal");

  assert.deepEqual(
    preCheck(data, model),
    [],
    "aggregate pre-checks should not catch this - it needs the elastic re-solve",
  );

  const diagnosis = await diagnoseInfeasibility(data, model);
  assert.equal(diagnosis.method, "elastic");
  assert.ok(diagnosis.issues.length > 0);
  // The solver's cheapest way to reach feasibility is to break ONE lock
  // (slack cost 1) rather than let Amy exceed her cap by 4 (slack cost 4) -
  // a more precise diagnosis than "over the load cap" would be, since it
  // names the actual lock in conflict.
  assert.ok(
    diagnosis.issues.some(
      (msg) => msg.includes("Amy") && msg.includes("Locking"),
    ),
    `expected an issue naming Amy's load cap, got: ${JSON.stringify(diagnosis.issues)}`,
  );
});

test("diagnoseInfeasibility() prefers the fast pre-check over the elastic re-solve when both would find the issue", async () => {
  const data = {
    teachers: [{ id: "t1", name: "Amy", maxPeriods: 20, subjects: ["Chem"] }],
    groups: [
      {
        id: "g1",
        level: 3,
        block: "Bio",
        label: "G1 Bio",
        periods: 4,
        band: null,
        teachersNeeded: 1,
      },
    ],
    assignments: [],
  };
  const model = buildModel(data);
  const diagnosis = await diagnoseInfeasibility(data, model);
  assert.equal(diagnosis.method, "precheck");
  assert.equal(diagnosis.issues.length, 1);
});
