import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as b from "../../src/board.js";
import { validate } from "../../src/data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadSample() {
  return JSON.parse(
    readFileSync(path.join(__dirname, "../../sample/sample.json"), "utf8"),
  );
}

function grp(
  id,
  level,
  block,
  stream,
  classIds,
  subjectId,
  periods,
  extra = {},
) {
  return {
    id,
    level,
    block,
    label: "x",
    periods,
    band: null,
    teachersNeeded: 1,
    category: stream,
    note: "",
    subjectId,
    discipline: block.toUpperCase(),
    stream,
    classIds,
    bandId: null,
    ...extra,
  };
}

function fixture() {
  return {
    roles: [
      { id: "teacher", name: "Teacher", maxPeriods: 20 },
      { id: "hod", name: "HOD", maxPeriods: 10 },
    ],
    subjects: [
      {
        id: "G2_PHY",
        name: "G2 Phy",
        discipline: "PHY",
        stream: "G2",
        periods: 6,
        levels: [3],
      },
      {
        id: "G3_PHY",
        name: "G3 Phy",
        discipline: "PHY",
        stream: "G3",
        periods: 6,
        levels: [3],
      },
      {
        id: "LSS",
        name: "LSS",
        discipline: "LSS",
        stream: "G1",
        periods: 12,
        levels: [1],
      },
    ],
    classes: [
      { id: "3E1", level: 3, name: "E1", subjectIds: [] },
      { id: "3E2", level: 3, name: "E2", subjectIds: [] },
    ],
    bands: [],
    teachers: [
      {
        id: "t1",
        name: "Amy",
        roleId: "teacher",
        capOverride: null,
        qualifications: ["G2_PHY", "G3_PHY"],
      },
      {
        id: "t2",
        name: "Ben",
        roleId: "teacher",
        capOverride: null,
        qualifications: ["G2_PHY"],
      },
      {
        id: "t3",
        name: "Cat",
        roleId: "hod",
        capOverride: null,
        qualifications: ["LSS"],
      },
    ],
    groups: [
      grp("g1", 3, "Phy", "G2", ["3E1"], "G2_PHY", 6),
      grp("g2", 3, "Phy", "G2", ["3E2"], "G2_PHY", 6),
      grp("g3", 3, "Phy", "G3", ["3N1"], "G3_PHY", 6),
      grp("g4", 1, "LSS", "G1", ["1A"], "LSS", 12),
    ],
    groupOverrides: {},
    customGroups: [],
    assignments: [],
    layerSettings: [],
    versions: [],
  };
}

/** Firestore rejects undefined values; JSON drops them, so a round-trip must be a no-op. */
function assertPlain(data) {
  assert.deepEqual(data, JSON.parse(JSON.stringify(data)));
}

function allRows(data, arrange = "subject") {
  return b
    .buildBoard(data, arrange)
    .sections.flatMap((s) => s.cards.flatMap((c) => c.rows));
}

// --- labels -------------------------------------------------------------

test("groupLabel(): one class and no stream is bare", () => {
  assert.equal(
    b.groupLabel(grp("a", 3, "Phy", "", ["3E1"], "S", 6)),
    "S3 Phy 3E1",
  );
});

test("groupLabel(): a stream puts the classes in brackets", () => {
  assert.equal(
    b.groupLabel(grp("a", 3, "Phy", "G2", ["3E1"], "S", 6)),
    "S3 Phy G2 (3E1)",
  );
});

test("groupLabel(): combined classes are joined with +", () => {
  assert.equal(
    b.groupLabel(grp("a", 3, "Phy", "G2", ["3E1", "3E2"], "S", 6)),
    "S3 Phy G2 (3E1+3E2)",
  );
});

test("groupLabel(): no classes yet", () => {
  assert.equal(
    b.groupLabel(grp("a", 4, "Chem", "G3", [], "S", 6)),
    "S4 Chem G3",
  );
});

test("relabel(): numbers identical names in list order and leaves unique ones alone", () => {
  const gs = [
    grp("a", 3, "Phy", "G3", ["3E1", "3E2"], "S", 6),
    grp("b", 3, "Phy", "G3", ["3E1", "3E2"], "S", 6),
    grp("c", 3, "Phy", "G2", ["3E1"], "S2", 6),
  ];
  assert.deepEqual(
    b.relabel(gs).map((g) => g.label),
    ["S3 Phy G3 (3E1+3E2) #1", "S3 Phy G3 (3E1+3E2) #2", "S3 Phy G2 (3E1)"],
  );
});

test("relabel(): keeps a manual label untouched", () => {
  const gs = [
    grp("a", 3, "Phy", "G3", ["3E1"], "S", 6, {
      label: "Club",
      manualLabel: true,
    }),
  ];
  assert.equal(b.relabel(gs)[0].label, "Club");
});

// --- buildBoard -----------------------------------------------------------

test("buildBoard(): rows are sorted by stream then class, groups with no class last", () => {
  const data = fixture();
  data.groups.push(grp("g5", 3, "Phy", "G2", [], "G2_PHY", 6));
  const phy = b
    .buildBoard(data, "subject")
    .sections.find((s) => s.key === "Phy");
  assert.deepEqual(
    phy.cards[0].rows.map((r) => r.groupId),
    ["g1", "g2", "g5", "g3"],
  );
});

test("buildBoard(): arranges sections by subject or by level", () => {
  const data = fixture();
  assert.deepEqual(
    b.buildBoard(data, "subject").sections.map((s) => s.key),
    ["LSS", "Phy"],
  );
  assert.deepEqual(
    b.buildBoard(data, "level").sections.map((s) => s.key),
    ["1", "3"],
  );
});

test("buildBoard(): flags big groups using the configured threshold", () => {
  const data = fixture();
  const rows = allRows(data);
  assert.equal(rows.find((r) => r.groupId === "g4").isBig, true);
  assert.equal(rows.find((r) => r.groupId === "g1").isBig, false);
  data.settings = { bigPeriods: 6 };
  assert.equal(allRows(data).find((r) => r.groupId === "g1").isBig, true);
});

test("buildBoard(): row warnings for an empty seat, an unqualified teacher and a band clash", () => {
  const data = fixture();
  data.groups[0] = { ...data.groups[0], bandId: "b1" };
  data.groups[1] = { ...data.groups[1], bandId: "b1" };
  data.assignments = [
    { teacherId: "t2", groupId: "g3", locked: false },
    { teacherId: "t1", groupId: "g1", locked: false },
    { teacherId: "t1", groupId: "g2", locked: false },
  ];
  const rows = allRows(data);
  const byId = (id) => rows.find((r) => r.groupId === id);
  assert.match(byId("g4").warnings.join(" "), /Needs 1 more teacher/);
  assert.match(byId("g3").warnings.join(" "), /Ben isn't qualified/);
  assert.match(byId("g1").warnings.join(" "), /same time/);
});

test("buildBoard(): a stale assignment shows the raw id and does not throw", () => {
  const data = fixture();
  data.assignments = [{ teacherId: "ghost", groupId: "g1", locked: false }];
  const rows = allRows(data);
  assert.equal(
    rows.find((r) => r.groupId === "g1").seats[0].teacherName,
    "ghost",
  );
});

test("buildBoard(): an empty school gives no sections", () => {
  assert.deepEqual(
    b.buildBoard({ groups: [], teachers: [], assignments: [] }, "subject")
      .sections,
    [],
  );
});

test("buildBoard() shows a typed custom-group name as typed, even before the board owns the groups", () => {
  const rows = allRows(loadSample());
  assert.equal(
    rows.find((r) => r.groupId === "g-custom-enrich").name,
    "Enrichment: Chem Research Club",
  );
});

test("buildBoard() never modifies an old sample file", () => {
  const sample = loadSample();
  const before = structuredClone(sample);
  b.buildBoard(sample, "subject");
  assert.deepEqual(sample, before);
  assert.deepEqual(validate(sample), []);
});

// --- group operations ----------------------------------------------------

test("addGroup(): adds a group that sorts next to its siblings and freezes the board", () => {
  const out = b.addGroup(fixture(), {
    level: 3,
    subjectId: "G2_PHY",
    id: "gNew",
  });
  assert.equal(out.error, null);
  assert.equal(out.data.groupsFrozen, true);
  const added = out.data.groups.find((g) => g.id === "gNew");
  assert.equal(added.periods, 6);
  assert.equal(added.block, "Phy");
  assert.equal(added.stream, "G2");
  assert.equal(added.label, "S3 Phy G2");
  const phy = b
    .buildBoard(out.data, "subject")
    .sections.find((s) => s.key === "Phy");
  assert.deepEqual(
    phy.cards[0].rows.map((r) => r.groupId),
    ["g1", "g2", "gNew", "g3"],
  );
  assertPlain(out.data);
});

test("addGroup(): refuses an unknown subject without changing anything", () => {
  const data = fixture();
  const out = b.addGroup(data, { level: 3, subjectId: "nope", id: "x" });
  assert.match(out.error, /subject/i);
  assert.equal(out.data, data);
});

test("deleteGroup(): removes the group and its assignments", () => {
  const data = fixture();
  data.assignments = [{ teacherId: "t1", groupId: "g1", locked: false }];
  const out = b.deleteGroup(data, "g1");
  assert.equal(
    out.data.groups.some((g) => g.id === "g1"),
    false,
  );
  assert.deepEqual(out.data.assignments, []);
  assertPlain(out.data);
});

test("duplicateGroup(): inserts an unassigned copy straight after the original", () => {
  const data = fixture();
  data.assignments = [{ teacherId: "t1", groupId: "g1", locked: false }];
  const out = b.duplicateGroup(data, "g1", "g1b");
  assert.deepEqual(
    out.data.groups.map((g) => g.id),
    ["g1", "g1b", "g2", "g3", "g4"],
  );
  assert.equal(out.data.assignments.length, 1);
  assert.equal(out.data.groups[1].label, "S3 Phy G2 (3E1) #2");
});

test("splitGroup(): one group per class; the first keeps the original id and its teacher", () => {
  const data = fixture();
  data.groups[0] = grp("g1", 3, "Phy", "G2", ["3E1", "3E2"], "G2_PHY", 6, {
    bandId: "b1",
    band: "b1",
  });
  data.assignments = [{ teacherId: "t1", groupId: "g1", locked: false }];
  let n = 0;
  const out = b.splitGroup(data, "g1", () => `new${++n}`);
  assert.deepEqual(
    out.data.groups.slice(0, 2).map((g) => [g.id, g.classIds, g.bandId]),
    [
      ["g1", ["3E1"], null],
      ["new1", ["3E2"], null],
    ],
  );
  assert.deepEqual(out.data.assignments, [
    { teacherId: "t1", groupId: "g1", locked: false },
  ]);
  assertPlain(out.data);
});

test("splitGroup(): refuses a group with one class", () => {
  const out = b.splitGroup(fixture(), "g1", () => "x");
  assert.match(out.error, /only one class/);
});

test("combineGroups(): merges classes into the first group and drops the others' assignments", () => {
  const data = fixture();
  data.assignments = [
    { teacherId: "t1", groupId: "g1", locked: false },
    { teacherId: "t2", groupId: "g2", locked: false },
  ];
  const out = b.combineGroups(data, ["g1", "g2"], {});
  assert.deepEqual(
    out.data.groups.map((g) => g.id),
    ["g1", "g3", "g4"],
  );
  assert.deepEqual(out.data.groups[0].classIds, ["3E1", "3E2"]);
  assert.equal(out.data.groups[0].label, "S3 Phy G2 (3E1+3E2)");
  assert.deepEqual(out.data.assignments, [
    { teacherId: "t1", groupId: "g1", locked: false },
  ]);
});

test("combineGroups(): refuses different subjects", () => {
  const out = b.combineGroups(fixture(), ["g1", "g3"], {});
  assert.match(out.error, /same subject and level/);
});

test("updateGroup(): lowering teachersNeeded trims seats; periods must be a whole number", () => {
  const data = fixture();
  data.groups[0] = { ...data.groups[0], teachersNeeded: 2 };
  data.assignments = [
    { teacherId: "t1", groupId: "g1", locked: false },
    { teacherId: "t2", groupId: "g1", locked: false },
  ];
  const out = b.updateGroup(data, "g1", { teachersNeeded: 1 });
  assert.deepEqual(
    out.data.assignments.map((a) => a.teacherId),
    ["t1"],
  );
  assert.match(
    b.updateGroup(data, "g1", { periods: "abc" }).error,
    /whole number/,
  );
});

test("updateGroup(): a typed name becomes manual; clearing it goes back to the auto name", () => {
  const named = b.updateGroup(fixture(), "g1", { label: "Special" });
  assert.equal(named.data.groups[0].label, "Special");
  assert.equal(named.data.groups[0].manualLabel, true);
  const cleared = b.updateGroup(named.data, "g1", { label: "  " });
  assert.equal(cleared.data.groups[0].label, "S3 Phy G2 (3E1)");
  assert.equal("manualLabel" in cleared.data.groups[0], false);
  assertPlain(cleared.data);
});

test("updateGroup(): changing the stream also changes the category and the name", () => {
  const out = b.updateGroup(fixture(), "g1", { stream: "G3" });
  assert.equal(out.data.groups[0].category, "G3");
  assert.equal(out.data.groups[0].label, "S3 Phy G3 (3E1)");
});

test("the first edit on an unfrozen file keeps a typed custom-group name", () => {
  const sample = loadSample();
  const other = sample.groups.find((g) => g.id !== "g-custom-enrich").id;
  const out = b.deleteGroup(sample, other);
  const custom = out.data.groups.find((g) => g.id === "g-custom-enrich");
  assert.equal(custom.label, "Enrichment: Chem Research Club");
  assert.equal(custom.manualLabel, true);
  assertPlain(out.data);
});

test("clearGroupSeats(): removes every teacher from one group", () => {
  const data = fixture();
  data.assignments = [
    { teacherId: "t1", groupId: "g1", locked: false },
    { teacherId: "t2", groupId: "g2", locked: false },
  ];
  const out = b.clearGroupSeats(data, "g1");
  assert.deepEqual(out.data.assignments, [
    { teacherId: "t2", groupId: "g2", locked: false },
  ]);
});

test("rebuildFromSetup(): freezes, renames, keeps typed custom labels and reports dropped assignments", () => {
  const { data, droppedCount } = b.rebuildFromSetup(loadSample());
  assert.equal(data.groupsFrozen, true);
  assert.equal(droppedCount, 0);
  const custom = data.groups.find((g) => g.id === "g-custom-enrich");
  assert.equal(custom.label, "Enrichment: Chem Research Club");
  assert.equal(custom.manualLabel, true);
  for (const g of data.groups)
    if (!g.manualLabel) assert.match(g.label, /^S\d /);
  assert.deepEqual(validate(data), []);
  assertPlain(data);
});

// --- seat operations -------------------------------------------------------

const A = (teacherId, groupId, locked = false) => ({
  teacherId,
  groupId,
  locked,
});

test("assignSeat(): puts a qualified teacher in a seat as an unlocked assignment", () => {
  const out = b.assignSeat(fixture(), "g1", 0, "t1");
  assert.equal(out.error, null);
  assert.deepEqual(out.data.assignments, [A("t1", "g1")]);
  assertPlain(out.data);
});

test("assignSeat(): refuses an unqualified teacher with a plain-language reason", () => {
  const data = fixture();
  const out = b.assignSeat(data, "g3", 0, "t2");
  assert.match(out.error, /Ben isn't qualified/);
  assert.equal(out.data, data);
});

test("assignSeat(): refuses the same teacher twice on one group, and a seat beyond teachersNeeded", () => {
  const data = fixture();
  data.groups[0] = { ...data.groups[0], teachersNeeded: 2 };
  const once = b.assignSeat(data, "g1", 0, "t1").data;
  assert.match(b.assignSeat(once, "g1", 1, "t1").error, /already teaching/);
  assert.match(b.assignSeat(data, "g2", 1, "t1").error, /only 1 seat/);
});

test("assignSeat(): an empty teacher id clears the seat; a locked seat can still be cleared", () => {
  const data = fixture();
  data.assignments = [A("t1", "g1", true)];
  assert.deepEqual(b.assignSeat(data, "g1", 0, "").data.assignments, []);
});

test("assignSeat(): allows going over cap (the tally warns instead)", () => {
  const data = fixture();
  data.assignments = [A("t3", "g4")]; // HOD cap 10, group is 12 periods
  assert.equal(b.assignSeat(fixture(), "g4", 0, "t3").error, null);
  assert.equal(b.assignSeat(data, "g4", 0, "t3").error, null);
});

test("dropSeat(): swaps two filled seats and unlocks both", () => {
  const data = fixture();
  data.assignments = [A("t1", "g1"), A("t2", "g2")];
  const out = b.dropSeat(
    data,
    { groupId: "g1", seatIndex: 0 },
    { groupId: "g2", seatIndex: 0 },
  );
  assert.equal(out.error, null);
  assert.deepEqual(out.data.assignments, [A("t2", "g1"), A("t1", "g2")]);
});

test("dropSeat(): moves into an empty seat", () => {
  const data = fixture();
  data.assignments = [A("t1", "g1")];
  const out = b.dropSeat(
    data,
    { groupId: "g1", seatIndex: 0 },
    { groupId: "g2", seatIndex: 0 },
  );
  assert.deepEqual(out.data.assignments, [A("t1", "g2")]);
});

test("dropSeat(): refuses a swap that would put someone on a subject they are not qualified for", () => {
  const data = fixture();
  data.assignments = [A("t2", "g1"), A("t1", "g3")];
  const out = b.dropSeat(
    data,
    { groupId: "g1", seatIndex: 0 },
    { groupId: "g3", seatIndex: 0 },
  );
  assert.match(out.error, /isn't qualified/);
  assert.equal(out.data, data);
});

test("dropSeat(): refuses to move a locked seat or to drop onto one", () => {
  const data = fixture();
  data.assignments = [A("t1", "g1", true), A("t2", "g2")];
  assert.match(
    b.dropSeat(
      data,
      { groupId: "g1", seatIndex: 0 },
      { groupId: "g2", seatIndex: 0 },
    ).error,
    /locked/,
  );
  assert.match(
    b.dropSeat(
      data,
      { groupId: "g2", seatIndex: 0 },
      { groupId: "g1", seatIndex: 0 },
    ).error,
    /locked/,
  );
});

test("dropSeat(): dropping a seat on itself or inside its own group changes nothing", () => {
  const data = fixture();
  data.assignments = [A("t1", "g1")];
  const out = b.dropSeat(
    data,
    { groupId: "g1", seatIndex: 0 },
    { groupId: "g1", seatIndex: 0 },
  );
  assert.equal(out.error, null);
  assert.equal(out.data, data);
});

test("dropSeat(): into a co-taught group fills its free seat; none free is refused", () => {
  const data = fixture();
  data.groups[1] = { ...data.groups[1], teachersNeeded: 2 };
  data.assignments = [A("t1", "g1"), A("t2", "g2")];
  const moved = b.dropSeat(
    data,
    { groupId: "g1", seatIndex: 0 },
    { groupId: "g2", seatIndex: 1 },
  );
  assert.deepEqual(
    moved.data.assignments
      .filter((a) => a.groupId === "g2")
      .map((a) => a.teacherId)
      .sort(),
    ["t1", "t2"],
  );
  const full = fixture();
  full.assignments = [A("t1", "g1"), A("t2", "g2")]; // g2 needs 1 and has 1
  assert.match(
    b.dropSeat(
      full,
      { groupId: "g1", seatIndex: 0 },
      { groupId: "g2", seatIndex: 1 },
    ).error,
    /no free seat/,
  );
});

test("assignToTeacher(): moves a seat to another teacher, refusing a locked or unqualified one", () => {
  const data = fixture();
  data.assignments = [A("t1", "g3")];
  assert.match(
    b.assignToTeacher(data, { groupId: "g3", seatIndex: 0 }, "t2").error,
    /isn't qualified/,
  );
  data.assignments = [A("t1", "g1", true)];
  assert.match(
    b.assignToTeacher(data, { groupId: "g1", seatIndex: 0 }, "t2").error,
    /locked/,
  );
  data.assignments = [A("t1", "g1")];
  assert.deepEqual(
    b.assignToTeacher(data, { groupId: "g1", seatIndex: 0 }, "t2").data
      .assignments,
    [A("t2", "g1")],
  );
});

test("toggleLock(): flips the lock on a filled seat and refuses an empty one", () => {
  const data = fixture();
  data.assignments = [A("t1", "g1")];
  assert.equal(b.toggleLock(data, "g1", 0).data.assignments[0].locked, true);
  assert.match(b.toggleLock(data, "g2", 0).error, /Nothing to lock/);
});

// --- tally -----------------------------------------------------------------

test("buildTally(): load, percent, big/small, classes and status per teacher", () => {
  const data = fixture();
  data.assignments = [
    A("t1", "g1"),
    A("t1", "g3"),
    A("t2", "g2"),
    A("t3", "g4"),
  ];
  const { rows } = b.buildTally(data);
  const amy = rows.find((r) => r.teacherId === "t1");
  assert.deepEqual(
    [amy.load, amy.cap, amy.pct, amy.big, amy.small, amy.classes],
    [12, 20, 60, 0, 2, 2],
  );
  assert.equal(amy.statusKind, "ok");
  assert.equal(amy.statusText, "Room for 8p");
  const cat = rows.find((r) => r.teacherId === "t3");
  assert.equal(cat.statusKind, "over");
  assert.match(cat.statusText, /Over cap by 2/);
});

test("buildTally(): flags exact big/small counts and max groups that are not met", () => {
  const data = fixture();
  data.teachers[0] = {
    ...data.teachers[0],
    bigCount: 1,
    smallCount: 0,
    maxGroups: 1,
  };
  data.assignments = [A("t1", "g1"), A("t1", "g3")];
  const amy = b.buildTally(data).rows.find((r) => r.teacherId === "t1");
  assert.equal(amy.statusKind, "warn");
  assert.match(amy.warnings.join(" "), /Wants 1 big \(has 0\)/);
  assert.match(amy.warnings.join(" "), /Wants 0 small \(has 2\)/);
  assert.match(amy.warnings.join(" "), /Max 1 classes \(has 2\)/);
});

test("buildTally(): totals compare demand with capacity and report the spread", () => {
  const data = fixture();
  data.assignments = [
    A("t1", "g1"),
    A("t1", "g3"),
    A("t2", "g2"),
    A("t3", "g4"),
  ];
  const { totals } = b.buildTally(data);
  assert.equal(totals.demand, 30);
  assert.equal(totals.capacity, 50);
  assert.equal(totals.unfilledSeats, 0);
  assert.equal(totals.spreadPct, 90); // Cat 120% vs Ben 30%
  assert.equal(totals.teachersOverCap.length, 1);
});

test("buildTally(): placeholders are listed but left out of capacity and spread", () => {
  const data = fixture();
  data.teachers.push({
    id: "t9",
    name: "New",
    roleId: "teacher",
    capOverride: null,
    qualifications: [],
    isPlaceholder: true,
  });
  const { rows, totals } = b.buildTally(data);
  assert.equal(
    rows.find((r) => r.teacherId === "t9").statusKind,
    "placeholder",
  );
  assert.equal(totals.capacity, 50);
});

test("buildTally(): an empty school gives no rows and zero totals", () => {
  const { rows, totals } = b.buildTally({
    teachers: [],
    groups: [],
    assignments: [],
    roles: [],
  });
  assert.deepEqual(rows, []);
  assert.equal(totals.demand, 0);
  assert.equal(totals.spreadPct, 0);
});

test("buildTally(): a stale assignment does not throw", () => {
  const data = fixture();
  data.assignments = [A("ghost", "g1"), A("t1", "gone")];
  assert.doesNotThrow(() => b.buildTally(data));
});

test("refusal messages use the same name the board shows, even before groups are frozen", () => {
  // fixture groups carry the stale stored label "x"; the board shows the auto-name
  const out = b.assignSeat(fixture(), "g3", 0, "t2");
  assert.match(out.error, /S3 Phy G3 \(3N1\)/);
  const data = fixture();
  data.assignments = [A("t2", "g1"), A("t1", "g3")];
  const drop = b.dropSeat(
    data,
    { groupId: "g1", seatIndex: 0 },
    { groupId: "g3", seatIndex: 0 },
  );
  assert.match(drop.error, /S3 Phy G3 \(3N1\)/);
});

test("updateGroup(): lowering teachersNeeded keeps a locked teacher and says who was removed", () => {
  const data = fixture();
  data.groups[0] = { ...data.groups[0], teachersNeeded: 2 };
  data.assignments = [A("t1", "g1", false), A("t2", "g1", true)];
  const out = b.updateGroup(data, "g1", { teachersNeeded: 1 });
  assert.deepEqual(
    out.data.assignments.map((a) => a.teacherId),
    ["t2"],
  );
  assert.match(out.notice, /Removed Amy/);
  assert.equal(b.updateGroup(data, "g1", { note: "x" }).notice, undefined);
});
