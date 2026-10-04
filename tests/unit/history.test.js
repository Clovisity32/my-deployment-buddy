import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistory } from "../../src/history.js";

const school = (over = {}) => ({
  teachers: [{ id: "t1" }, { id: "t2" }],
  groups: [{ id: "g1" }, { id: "g2" }],
  assignments: [],
  ...over,
});

function assertPlain(data) {
  assert.deepEqual(data, JSON.parse(JSON.stringify(data)));
}

test("undo restores groups and assignments but leaves everything else alone", () => {
  const h = createHistory();
  const before = school({
    assignments: [{ teacherId: "t1", groupId: "g1", locked: false }],
  });
  h.record(before);
  const now = school({
    teachers: [{ id: "t1" }, { id: "t2" }, { id: "t3" }],
    assignments: [],
  });
  const undone = h.undo(now);
  assert.deepEqual(undone.assignments, before.assignments);
  assert.equal(undone.teachers.length, 3); // other tabs' data is not reverted
});

test("redo brings the undone state back", () => {
  const h = createHistory();
  const a = school({
    assignments: [{ teacherId: "t1", groupId: "g1", locked: false }],
  });
  const b = school({
    assignments: [{ teacherId: "t2", groupId: "g1", locked: false }],
  });
  h.record(a);
  const undone = h.undo(b);
  assert.deepEqual(undone.assignments, a.assignments);
  assert.deepEqual(h.redo(undone).assignments, b.assignments);
});

test("undo and redo return null when there is nothing to do", () => {
  const h = createHistory();
  assert.equal(h.undo(school()), null);
  assert.equal(h.redo(school()), null);
});

test("an absent groupsFrozen stays absent after undo (Firestore rejects undefined)", () => {
  const h = createHistory();
  h.record(school());
  const out = h.undo(school({ groupsFrozen: true }));
  assert.equal("groupsFrozen" in out, false);
  assertPlain(out);
});

test("reset forgets everything, so Undo cannot reach a previous school", () => {
  const h = createHistory();
  h.record(
    school({
      assignments: [{ teacherId: "t1", groupId: "g1", locked: false }],
    }),
  );
  h.reset();
  assert.equal(h.undo(school()), null);
});

test("undo drops assignments whose teacher or group no longer exists", () => {
  const h = createHistory();
  h.record(
    school({
      assignments: [
        { teacherId: "t1", groupId: "g1", locked: false },
        { teacherId: "gone", groupId: "g1", locked: false },
        { teacherId: "t1", groupId: "gone", locked: false },
      ],
    }),
  );
  const out = h.undo(school({ teachers: [{ id: "t1" }] }));
  assert.deepEqual(out.assignments, [
    { teacherId: "t1", groupId: "g1", locked: false },
  ]);
});

test("history keeps only the most recent steps", () => {
  const h = createHistory(2);
  for (let i = 0; i < 3; i++)
    h.record(
      school({
        assignments: [{ teacherId: "t1", groupId: "g1", locked: i === 0 }],
      }),
    );
  assert.ok(h.undo(school()));
  assert.ok(h.undo(school()));
  assert.equal(h.undo(school()), null);
});
