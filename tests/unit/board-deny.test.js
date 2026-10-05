import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "../../src/board.js";

test("a seat held by a denied teacher is flagged and warned about", () => {
  const data = {
    roles: [{ id: "r", name: "R", maxPeriods: 100 }],
    teachers: [
      {
        id: "t1",
        name: "Amy",
        roleId: "r",
        qualifications: ["A"],
        denies: [{ level: 3 }],
      },
    ],
    groups: [
      {
        id: "g1",
        level: 3,
        block: "A",
        label: "g1",
        periods: 6,
        teachersNeeded: 1,
        subjectId: "A",
        stream: "G2",
        classIds: [],
      },
    ],
    assignments: [{ groupId: "g1", teacherId: "t1", locked: false }],
  };
  const row = buildBoard(data).sections[0].cards[0].rows[0];
  assert.equal(row.seats[0].denied, true);
  assert.ok(
    row.warnings.some((w) => w.includes("deny list")),
    row.warnings.join("|"),
  );
  const ok = buildBoard({
    ...data,
    teachers: [{ ...data.teachers[0], denies: [] }],
  });
  assert.equal(ok.sections[0].cards[0].rows[0].seats[0].denied, false);
});
