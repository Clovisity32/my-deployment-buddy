import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyData } from "../../src/data.js";
import {
  defaultClassNames,
  generateClasses,
  generateGroups,
  setupWarnings,
  rebuildGroups,
} from "../../src/setup.js";

// --- generateClasses --------------------------------------------------------

test("generateClasses() creates fresh classes with sequential codes", () => {
  const classes = generateClasses({ 1: 3 }, defaultClassNames(), []);
  assert.deepEqual(
    classes.map((c) => c.id),
    ["101", "102", "103"],
  );
  assert.equal(classes[0].level, 1);
  assert.equal(classes[0].name, "Curiosity");
  assert.deepEqual(classes[0].subjectIds, []);
});

test("generateClasses() preserves an existing class's edited name and subjectIds on re-generation", () => {
  const existing = [
    { id: "101", level: 1, name: "Renamed", subjectIds: ["G1_LSS"] },
  ];
  const classes = generateClasses({ 1: 2 }, defaultClassNames(), existing);
  const c101 = classes.find((c) => c.id === "101");
  assert.equal(c101.name, "Renamed");
  assert.deepEqual(c101.subjectIds, ["G1_LSS"]);
  const c102 = classes.find((c) => c.id === "102");
  assert.equal(c102.name, "Adaptability");
  assert.deepEqual(c102.subjectIds, []);
});

test("generateClasses() shrinking the count drops trailing classes", () => {
  const existing = [
    { id: "101", level: 1, name: "A", subjectIds: [] },
    { id: "102", level: 1, name: "B", subjectIds: [] },
    { id: "103", level: 1, name: "C", subjectIds: [] },
  ];
  const classes = generateClasses({ 1: 1 }, defaultClassNames(), existing);
  assert.deepEqual(
    classes.map((c) => c.id),
    ["101"],
  );
});

test("generateClasses() leaves classes at untouched levels alone", () => {
  const existing = [{ id: "201", level: 2, name: "X", subjectIds: ["s1"] }];
  const classes = generateClasses({ 1: 1 }, defaultClassNames(), existing);
  assert.ok(classes.some((c) => c.id === "101"));
  const c201 = classes.find((c) => c.id === "201");
  assert.deepEqual(c201, existing[0]);
});

// --- generateGroups ----------------------------------------------------------

function baseData(overrides = {}) {
  return {
    ...emptyData(),
    subjects: [
      {
        id: "G2_SCI_CHEM",
        name: "G2 SCI_CHEM",
        discipline: "CHEM",
        stream: "G2",
        periods: 4,
        levels: [3, 4],
      },
      {
        id: "G3_SCI_PHY",
        name: "G3 SCI_PHY",
        discipline: "PHY",
        stream: "G3",
        periods: 6,
        levels: [3, 4, 5],
      },
    ],
    classes: [
      { id: "302", level: 3, name: "Respect", subjectIds: ["G2_SCI_CHEM"] },
      {
        id: "303",
        level: 3,
        name: "Responsibility",
        subjectIds: ["G3_SCI_PHY"],
      },
      { id: "304", level: 3, name: "Resilience", subjectIds: ["G3_SCI_PHY"] },
    ],
    bands: [],
    ...overrides,
  };
}

test("generateGroups() emits 1 group for an unbanded (class, subject) pair", () => {
  const data = baseData();
  const groups = generateGroups(data);
  const g = groups.find((x) => x.subjectId === "G2_SCI_CHEM");
  assert.ok(g);
  assert.equal(g.id, "g_G2_SCI_CHEM_302");
  assert.equal(g.periods, 4);
  assert.equal(g.label, "302 G2 SCI_CHEM");
  assert.equal(g.block, "Chem");
  assert.equal(g.teachersNeeded, 1);
  assert.deepEqual(g.classIds, ["302"]);
  assert.equal(g.bandId, null);
});

test("generateGroups() emits 1 group spanning all classIds for a banded subject with groups:1", () => {
  const data = baseData({
    bands: [
      {
        id: "b1",
        name: "Band 1",
        classIds: ["303", "304"],
        subjects: [{ subjectId: "G3_SCI_PHY", groups: 1 }],
        note: "",
      },
    ],
  });
  const groups = generateGroups(data);
  const banded = groups.filter((g) => g.bandId === "b1");
  assert.equal(banded.length, 1);
  assert.equal(banded[0].id, "g_G3_SCI_PHY_b1");
  assert.deepEqual(banded[0].classIds, ["303", "304"]);
  assert.equal(banded[0].label, "303 & 304 G3 SCI_PHY");
  assert.equal(banded[0].note, "Banded: 303, 304");
});

test("generateGroups() emits n groups with Grp k labels for groups:3", () => {
  const data = baseData({
    bands: [
      {
        id: "b1",
        name: "Band 1",
        classIds: ["303", "304"],
        subjects: [{ subjectId: "G3_SCI_PHY", groups: 3 }],
        note: "",
      },
    ],
  });
  const groups = generateGroups(data);
  const banded = groups.filter((g) => g.bandId === "b1");
  assert.equal(banded.length, 3);
  assert.deepEqual(
    banded.map((g) => g.id),
    ["g_G3_SCI_PHY_b1_1", "g_G3_SCI_PHY_b1_2", "g_G3_SCI_PHY_b1_3"],
  );
  assert.deepEqual(
    banded.map((g) => g.label),
    [
      "Band 1 G3 SCI_PHY Grp 1",
      "Band 1 G3 SCI_PHY Grp 2",
      "Band 1 G3 SCI_PHY Grp 3",
    ],
  );
});

test("generateGroups() applies groupOverrides onto the matching generated group", () => {
  const data = baseData({
    groupOverrides: {
      g_G2_SCI_CHEM_302: {
        label: "Custom Label",
        teachersNeeded: 2,
        note: "hi",
      },
    },
  });
  const groups = generateGroups(data);
  const g = groups.find((x) => x.id === "g_G2_SCI_CHEM_302");
  assert.equal(g.label, "Custom Label");
  assert.equal(g.teachersNeeded, 2);
  assert.equal(g.note, "hi");
});

test("generateGroups() appends customGroups verbatim after generated groups", () => {
  const custom = {
    id: "custom-1",
    level: 5,
    block: "SCI",
    label: "Custom group",
    periods: 3,
    band: null,
    teachersNeeded: 1,
    category: "PURE",
    note: "",
    subjectId: null,
  };
  const data = baseData({ customGroups: [custom] });
  const groups = generateGroups(data);
  assert.deepEqual(groups[groups.length - 1], custom);
});

test("generateGroups() is deterministic across repeated calls", () => {
  const data = baseData({
    bands: [
      {
        id: "b1",
        name: "Band 1",
        classIds: ["303", "304"],
        subjects: [{ subjectId: "G3_SCI_PHY", groups: 2 }],
        note: "",
      },
    ],
  });
  assert.deepEqual(generateGroups(data), generateGroups(data));
});

// --- setupWarnings -----------------------------------------------------------

test("setupWarnings() returns [] for a clean fixture", () => {
  const data = baseData();
  assert.deepEqual(setupWarnings(data), []);
});

test("setupWarnings() flags a class taking a subject not offered at its level", () => {
  const data = baseData({
    classes: [{ id: "101", level: 1, name: "X", subjectIds: ["G2_SCI_CHEM"] }],
  });
  const warnings = setupWarnings(data);
  assert.ok(
    warnings.some(
      (w) =>
        w.includes('Class "101"') && w.includes("isn't offered at level 1"),
    ),
  );
});

test("setupWarnings() flags a (class, subject) pair banded in more than one band", () => {
  const data = baseData({
    bands: [
      {
        id: "b1",
        name: "Band 1",
        classIds: ["303"],
        subjects: [{ subjectId: "G3_SCI_PHY", groups: 1 }],
        note: "",
      },
      {
        id: "b2",
        name: "Band 2",
        classIds: ["303"],
        subjects: [{ subjectId: "G3_SCI_PHY", groups: 1 }],
        note: "",
      },
    ],
  });
  const warnings = setupWarnings(data);
  assert.ok(warnings.some((w) => w.includes("banded in more than one band")));
});

test("setupWarnings() flags a band subject none of its classes take", () => {
  const data = baseData({
    bands: [
      {
        id: "b1",
        name: "Band 1",
        classIds: ["302"], // 302 only takes G2_SCI_CHEM
        subjects: [{ subjectId: "G3_SCI_PHY", groups: 1 }],
        note: "",
      },
    ],
  });
  const warnings = setupWarnings(data);
  assert.ok(
    warnings.some((w) => w.includes("none of its classes take that subject")),
  );
});

test("setupWarnings() flags an Others teacher with no cap", () => {
  const data = baseData({
    roles: [{ id: "others", name: "Others", maxPeriods: null }],
    teachers: [
      {
        id: "t1",
        name: "Amy",
        roleId: "others",
        capOverride: null,
        qualifications: [],
      },
    ],
  });
  const warnings = setupWarnings(data);
  assert.ok(
    warnings.some((w) => w.includes('Teacher "Amy"') && w.includes("Others")),
  );
});

// --- rebuildGroups -------------------------------------------------------------

test("rebuildGroups() drops assignments whose group no longer exists and reports droppedCount", () => {
  const data = baseData({
    assignments: [
      { groupId: "g_G2_SCI_CHEM_302", teacherId: "t1", locked: false },
      { groupId: "ghost-group", teacherId: "t1", locked: false },
    ],
  });
  const { data: newData, droppedCount } = rebuildGroups(data);
  assert.equal(droppedCount, 1);
  assert.deepEqual(newData.assignments, [
    { groupId: "g_G2_SCI_CHEM_302", teacherId: "t1", locked: false },
  ]);
});

test("rebuildGroups() keeps assignments on surviving groups", () => {
  const data = baseData({
    assignments: [
      { groupId: "g_G2_SCI_CHEM_302", teacherId: "t1", locked: false },
    ],
  });
  const { droppedCount } = rebuildGroups(data);
  assert.equal(droppedCount, 0);
});

test("rebuildGroups() drops groupOverrides entries whose group id no longer exists after regeneration", () => {
  const data = baseData({
    groupOverrides: {
      g_G2_SCI_CHEM_302: { note: "surviving group note" },
      "ghost-group": { note: "dead entry - its group id was never generated" },
    },
  });
  const { data: newData } = rebuildGroups(data);
  assert.deepEqual(newData.groupOverrides, {
    g_G2_SCI_CHEM_302: { note: "surviving group note" },
  });
});
