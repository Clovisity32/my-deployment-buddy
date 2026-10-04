import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../../../src/model.js";
import { solveModel } from "../../../src/solve.js";
import { prepKey } from "../../../src/data.js";
import { fixture, group, teacher, OFF, ON } from "./rulesFixture.js";

// Same subject at two levels: Sec 3 twice, Sec 4 twice.
const d = () =>
  fixture({
    // maxGroups 2 each (hard) forces a 2 + 2 split; without it "t1 takes all four"
    // ties with "one level each" and the solve assertion below would be a coin toss.
    teachers: [
      teacher("t1", ["A"], { maxGroups: 2 }),
      teacher("t2", ["A"], { maxGroups: 2 }),
    ],
    groups: [
      group("a3x", "A", { level: 3 }),
      group("a3y", "A", { level: 3 }),
      group("a4x", "A", { level: 4 }),
      group("a4y", "A", { level: 4 }),
    ],
    layerSettings: [OFF("balance"), OFF("mix"), OFF("stable"), ON("preps", 2)],
  });

test("a prep is subject + stream + level: 2 teachers x 2 levels = 4 prep switches", () => {
  assert.equal(buildModel(d()).extraBinaryVars.length, 4);
});

test("preps pushes each teacher to a single level of the same subject", async () => {
  const data = d();
  const result = await solveModel(buildModel(data));
  assert.ok(result.optimal);
  const groupById = new Map(data.groups.map((g) => [g.id, g]));
  const preps = new Map();
  for (const a of result.assignments) {
    if (!preps.has(a.teacherId)) preps.set(a.teacherId, new Set());
    preps.get(a.teacherId).add(prepKey(groupById.get(a.groupId)));
  }
  assert.deepEqual(
    [...preps.values()].map((s) => s.size),
    [1, 1],
  );
});
