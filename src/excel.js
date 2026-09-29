// Excel import/export - the Excel file is the source of truth the HOD
// carries between home and school (see CLAUDE.md). Split into two halves:
//
//  - dataToSheets()/sheetsToData(): PURE mapping between our data shape and
//    plain arrays-of-rows (one array per sheet: Roles, Subjects, Classes,
//    Bands, Teachers, Groups, GroupOverrides, CustomGroups, Layers,
//    Deployment, Versions). No dependency on the XLSX library, so these are
//    unit-testable with plain Node. buildDeploymentLayoutRows() is a sibling
//    pure function for the human-readable "Deployment Layout" sheet, which
//    isn't one-row-per-record so it doesn't fit the json_to_sheet shape the
//    other sheets use.
//  - exportWorkbook()/importWorkbook(): thin wrappers around the real XLSX
//    library (vendored at ./vendor/xlsx/xlsx.full.min.js, loaded as a
//    classic <script> in index.html - see that file for why it isn't an ES
//    import). These only run in a browser and are exercised by the
//    Playwright e2e suite, which round-trips a real .xlsx file.

import { buildDeploymentView } from "./view.js";

const SUBJECT_SEPARATOR = ", ";

/**
 * Shared row shape for both the Groups sheet (generated + custom, already
 * merged snapshot) and the CustomGroups sheet (customGroups have the
 * identical Group+subjectId shape).
 * @param {any} g
 */
function groupToRow(g) {
  return {
    id: g.id,
    level: g.level,
    block: g.block,
    label: g.label,
    periods: g.periods,
    band: g.band || "",
    teachersNeeded: g.teachersNeeded,
    category: g.category || "",
    note: g.note || "",
    subjectId: g.subjectId || "",
    discipline: g.discipline || "",
    stream: g.stream || "",
    classIds: (g.classIds || []).join(SUBJECT_SEPARATOR),
    bandId: g.bandId || "",
  };
}

/**
 * Inverse of groupToRow(), shared by the Groups and CustomGroups sheets.
 * @param {any} row
 */
function rowToGroup(row) {
  return {
    id: String(row.id),
    level: toNumber(row.level),
    block: String(row.block),
    label: String(row.label),
    periods: toNumber(row.periods),
    band: row.band ? String(row.band) : null,
    teachersNeeded: toNumber(row.teachersNeeded),
    category: row.category ? String(row.category) : "",
    note: row.note ? String(row.note) : "",
    subjectId: row.subjectId ? String(row.subjectId) : null,
    discipline: row.discipline ? String(row.discipline) : "",
    stream: row.stream ? String(row.stream) : "",
    classIds: splitList(row.classIds),
    bandId: row.bandId ? String(row.bandId) : null,
  };
}

/**
 * Parses a Bands sheet "subjects" cell like "G3_SCI_PHY:3; G3_SCI_BIO:2"
 * back into [{subjectId, groups}]. Defensive: never throws, skips anything
 * that doesn't parse cleanly (empty cell, stray trailing separator, etc).
 * @param {any} cell
 * @returns {{subjectId:string, groups:number}[]}
 */
function parseBandSubjects(cell) {
  if (!cell) return [];
  return String(cell)
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const idx = segment.lastIndexOf(":");
      if (idx === -1) return null;
      const subjectId = segment.slice(0, idx).trim();
      const groups = Number(segment.slice(idx + 1).trim());
      if (!subjectId || !Number.isFinite(groups)) return null;
      return { subjectId, groups };
    })
    .filter(Boolean);
}

/**
 * @param {import('./data.js').default} data
 * @returns {{
 *   Roles:object[], Subjects:object[], Classes:object[], Bands:object[],
 *   Teachers:object[], Groups:object[], GroupOverrides:object[],
 *   CustomGroups:object[], Layers:object[], Deployment:object[],
 *   Versions:object[],
 * }}
 */
function dataToSheets(data) {
  return {
    Roles: (data.roles || []).map((r) => ({
      id: r.id,
      name: r.name,
      maxPeriods: r.maxPeriods ?? "",
    })),
    Subjects: (data.subjects || []).map((s) => ({
      id: s.id,
      name: s.name,
      discipline: s.discipline,
      stream: s.stream,
      periods: s.periods,
      levels: (s.levels || []).join(SUBJECT_SEPARATOR),
    })),
    Classes: (data.classes || []).map((c) => ({
      id: c.id,
      level: c.level,
      name: c.name,
      subjectIds: (c.subjectIds || []).join(SUBJECT_SEPARATOR),
    })),
    Bands: (data.bands || []).map((b) => ({
      id: b.id,
      name: b.name,
      classIds: (b.classIds || []).join(SUBJECT_SEPARATOR),
      subjects: (b.subjects || [])
        .map((s) => `${s.subjectId}:${s.groups}`)
        .join("; "),
      note: b.note || "",
    })),
    Teachers: (data.teachers || []).map((t) => ({
      id: t.id,
      name: t.name,
      roleId: t.roleId,
      capOverride: t.capOverride ?? "",
      qualifications: (t.qualifications || []).join(SUBJECT_SEPARATOR),
      isPlaceholder: Boolean(t.isPlaceholder),
    })),
    Groups: (data.groups || []).map(groupToRow),
    GroupOverrides: Object.entries(data.groupOverrides || {}).map(
      ([groupId, o]) => ({
        groupId,
        label: o.label ?? "",
        teachersNeeded: o.teachersNeeded ?? "",
        note: o.note ?? "",
      }),
    ),
    CustomGroups: (data.customGroups || []).map(groupToRow),
    Layers: (data.layerSettings || []).map((s) => ({
      id: s.id,
      enabled: Boolean(s.enabled),
      weight: s.weight,
    })),
    Deployment: (data.assignments || []).map((a) => ({
      teacherId: a.teacherId,
      groupId: a.groupId,
      locked: Boolean(a.locked),
    })),
    // Versions hold nested per-snapshot data that doesn't flatten naturally
    // into spreadsheet columns; the HOD isn't expected to hand-edit this
    // sheet, only carry it - so each snapshot's payload is one JSON cell.
    Versions: (data.versions || []).map((v) => ({
      name: v.name,
      timestamp: v.timestamp,
      assignmentsJson: JSON.stringify(v.assignments || []),
      layerSettingsJson: JSON.stringify(v.layerSettings || []),
    })),
  };
}

/**
 * Builds the human-readable "Deployment Layout" sheet as an array-of-arrays
 * (rows of cells), mirroring the HOD's original spreadsheet: one "Level N"
 * header row, one "Group / Teacher(s) / Note" header row, then each block's
 * rows one after another (blocks aren't laid out side by side - that isn't
 * practical in a single flat sheet), with a blank row between levels. Pure:
 * no XLSX dependency, so it's directly unit-testable.
 * @param {import('./data.js').default} data
 * @returns {string[][]}
 */
function buildDeploymentLayoutRows(data) {
  const levels = buildDeploymentView(data);
  const rows = [];
  levels.forEach((levelEntry, idx) => {
    rows.push([`Level ${levelEntry.level}`]);
    rows.push(["Group", "Teacher(s)", "Note"]);
    levelEntry.blocks.forEach((blockEntry) => {
      rows.push([blockEntry.block]);
      blockEntry.rows.forEach((row) => {
        rows.push([
          row.label,
          row.teacherNames.join(" / ") || "(unassigned)",
          row.note || "",
        ]);
      });
    });
    if (idx < levels.length - 1) rows.push([]);
  });
  return rows;
}

/**
 * @param {{
 *   Roles?:object[], Subjects?:object[], Classes?:object[], Bands?:object[],
 *   Teachers?:object[], Groups?:object[], GroupOverrides?:object[],
 *   CustomGroups?:object[], Layers?:object[], Deployment?:object[],
 *   Versions?:object[],
 * }} sheets
 * @returns {import('./data.js').default}
 */
function sheetsToData(sheets) {
  const roles = (sheets.Roles || []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    maxPeriods:
      row.maxPeriods === "" || row.maxPeriods == null
        ? null
        : toNumber(row.maxPeriods),
  }));

  const subjects = (sheets.Subjects || []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    discipline: String(row.discipline),
    stream: String(row.stream),
    periods: toNumber(row.periods),
    levels: splitList(row.levels)
      .map(Number)
      .filter((n) => Number.isFinite(n)),
  }));

  const classes = (sheets.Classes || []).map((row) => ({
    id: String(row.id),
    level: toNumber(row.level),
    name: String(row.name),
    subjectIds: splitList(row.subjectIds),
  }));

  const bands = (sheets.Bands || []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    classIds: splitList(row.classIds),
    subjects: parseBandSubjects(row.subjects),
    note: row.note || "",
  }));

  const teachers = (sheets.Teachers || []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    roleId: String(row.roleId || ""),
    capOverride:
      row.capOverride === "" || row.capOverride == null
        ? null
        : toNumber(row.capOverride),
    qualifications: splitList(row.qualifications),
    ...(toBool(row.isPlaceholder) ? { isPlaceholder: true } : {}),
  }));

  const groups = (sheets.Groups || []).map(rowToGroup);

  const groupOverrides = Object.fromEntries(
    (sheets.GroupOverrides || []).map((row) => [
      String(row.groupId),
      {
        ...(row.label !== "" && row.label != null ? { label: row.label } : {}),
        ...(row.teachersNeeded !== "" && row.teachersNeeded != null
          ? { teachersNeeded: toNumber(row.teachersNeeded) }
          : {}),
        ...(row.note !== "" && row.note != null ? { note: row.note } : {}),
      },
    ]),
  );

  const customGroups = (sheets.CustomGroups || []).map(rowToGroup);

  const layerSettings = (sheets.Layers || []).map((row) => ({
    id: String(row.id),
    enabled: toBool(row.enabled),
    weight: toNumber(row.weight),
  }));

  const assignments = (sheets.Deployment || []).map((row) => ({
    teacherId: String(row.teacherId),
    groupId: String(row.groupId),
    locked: toBool(row.locked),
  }));

  const versions = (sheets.Versions || []).map((row) => ({
    name: String(row.name),
    timestamp: String(row.timestamp),
    assignments: safeJsonParse(row.assignmentsJson, []),
    layerSettings: safeJsonParse(row.layerSettingsJson, []),
  }));

  return {
    roles,
    subjects,
    classes,
    bands,
    teachers,
    groups,
    groupOverrides,
    customGroups,
    assignments,
    layerSettings,
    versions,
  };
}

function toNumber(v) {
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return (
    String(v ?? "")
      .trim()
      .toUpperCase() === "TRUE"
  );
}

function splitList(v) {
  if (!v) return [];
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function safeJsonParse(v, fallback) {
  if (!v) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

/** Throws a clear error if the vendored XLSX global isn't loaded yet. */
function getXLSX() {
  if (typeof window === "undefined" || !window.XLSX) {
    throw new Error(
      "The Excel library is not loaded. Check that vendor/xlsx/xlsx.full.min.js is included (as a <script> tag) before this page's scripts run.",
    );
  }
  return window.XLSX;
}

/**
 * Writes `data` to an .xlsx file and triggers a browser download. Browser-only.
 * @param {import('./data.js').default} data
 * @param {string} [filename]
 */
function exportWorkbook(data, filename = "deployment.xlsx") {
  const XLSX = getXLSX();
  const sheets = dataToSheets(data);
  const workbook = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  }
  // Deployment Layout isn't one-row-per-record like the sheets above, so it's
  // built separately from an array-of-arrays and appended last.
  const layoutWorksheet = XLSX.utils.aoa_to_sheet(
    buildDeploymentLayoutRows(data),
  );
  XLSX.utils.book_append_sheet(workbook, layoutWorksheet, "Deployment Layout");
  XLSX.writeFile(workbook, filename);
}

/**
 * Reads an .xlsx File (e.g. from an <input type="file">) into a data object.
 * Browser-only. The "Deployment Layout" sheet (if present) is a
 * human-readable view, not a data source, so it's read like every other
 * sheet but simply never destructured by sheetsToData() - no special-casing
 * needed.
 * @param {File} file
 * @returns {Promise<import('./data.js').default>}
 */
async function importWorkbook(file) {
  const XLSX = getXLSX();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheets = {};
  for (const sheetName of workbook.SheetNames) {
    sheets[sheetName] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
  }
  return sheetsToData(sheets);
}

export {
  dataToSheets,
  sheetsToData,
  buildDeploymentLayoutRows,
  exportWorkbook,
  importWorkbook,
  getXLSX,
};
