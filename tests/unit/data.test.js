import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  emptyData,
  validate,
  loadFromStorage,
  saveToStorage,
} from "../../src/data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplePath = path.join(__dirname, "../../sample/sample.json");

// A minimal in-memory Storage stand-in for tests (no real browser available).
function makeMemoryStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = v;
    },
    removeItem: (k) => {
      delete store[k];
    },
    _raw: store,
  };
}

test("emptyData() has no validation errors", () => {
  assert.deepEqual(validate(emptyData()), []);
});

test("validate() accepts the fictional sample school", () => {
  const sample = JSON.parse(readFileSync(samplePath, "utf8"));
  const errors = validate(sample);
  assert.deepEqual(errors, []);
});

test("validate() rejects non-object input", () => {
  assert.ok(validate(null).length > 0);
  assert.ok(validate(undefined).length > 0);
  assert.ok(validate("not an object").length > 0);
  assert.ok(validate(42).length > 0);
});

test("validate() rejects missing/wrong-typed teachers array", () => {
  const errors = validate({ teachers: "nope", groups: [] });
  assert.ok(errors.some((e) => e.includes("teachers must be an array")));
});

test("validate() flags duplicate teacher ids", () => {
  const data = {
    teachers: [
      { id: "t1", name: "A", maxPeriods: 20, subjects: ["Chem"] },
      { id: "t1", name: "B", maxPeriods: 20, subjects: ["Phy"] },
    ],
    groups: [],
  };
  const errors = validate(data);
  assert.ok(errors.some((e) => e.includes("duplicated")));
});

test("validate() flags a group with non-positive periods", () => {
  const data = {
    teachers: [],
    groups: [
      {
        id: "g1",
        level: 1,
        block: "Chem",
        label: "x",
        periods: 0,
        band: null,
        teachersNeeded: 1,
      },
    ],
  };
  const errors = validate(data);
  assert.ok(
    errors.some((e) => e.includes("periods must be a positive number")),
  );
});

test("validate() flags an assignment referencing an unknown teacher or group", () => {
  const data = {
    teachers: [{ id: "t1", name: "A", maxPeriods: 20, subjects: ["Chem"] }],
    groups: [
      {
        id: "g1",
        level: 1,
        block: "Chem",
        label: "x",
        periods: 4,
        band: null,
        teachersNeeded: 1,
      },
    ],
    assignments: [{ groupId: "g1", teacherId: "ghost", locked: false }],
  };
  const errors = validate(data);
  assert.ok(errors.some((e) => e.includes("does not match any teacher")));
});

test("validate() accepts a valid assignment", () => {
  const data = {
    teachers: [{ id: "t1", name: "A", maxPeriods: 20, subjects: ["Chem"] }],
    groups: [
      {
        id: "g1",
        level: 1,
        block: "Chem",
        label: "x",
        periods: 4,
        band: null,
        teachersNeeded: 1,
      },
    ],
    assignments: [{ groupId: "g1", teacherId: "t1", locked: false }],
  };
  assert.deepEqual(validate(data), []);
});

test("loadFromStorage() returns emptyData() when nothing is stored", () => {
  const storage = makeMemoryStorage();
  assert.deepEqual(loadFromStorage(storage), emptyData());
});

test("loadFromStorage() returns emptyData() on corrupt JSON", () => {
  const storage = makeMemoryStorage({ "deploymentBuddy.v1": "{not json" });
  assert.deepEqual(loadFromStorage(storage), emptyData());
});

test("loadFromStorage() returns emptyData() when stored shape is invalid", () => {
  const storage = makeMemoryStorage({
    "deploymentBuddy.v1": JSON.stringify({ teachers: "nope" }),
  });
  assert.deepEqual(loadFromStorage(storage), emptyData());
});

test("saveToStorage() then loadFromStorage() round-trips valid data", () => {
  const storage = makeMemoryStorage();
  const sample = JSON.parse(readFileSync(samplePath, "utf8"));
  assert.equal(saveToStorage(sample, storage), true);
  assert.deepEqual(loadFromStorage(storage), sample);
});

test("saveToStorage() returns false and does not throw when storage.setItem throws", () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota exceeded");
    },
  };
  assert.equal(saveToStorage(emptyData(), storage), false);
});
