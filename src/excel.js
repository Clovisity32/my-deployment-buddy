// Excel import/export - the Excel file is the source of truth the HOD
// carries between home and school (see CLAUDE.md). Split into two halves:
//
//  - dataToSheets()/sheetsToData(): PURE mapping between our data shape and
//    plain arrays-of-rows (one array per sheet: Teachers, Groups, Layers,
//    Deployment, Versions). No dependency on the XLSX library, so these are
//    unit-testable with plain Node.
//  - exportWorkbook()/importWorkbook(): thin wrappers around the real XLSX
//    library (vendored at ./vendor/xlsx/xlsx.full.min.js, loaded as a
//    classic <script> in index.html - see that file for why it isn't an ES
//    import). These only run in a browser and are exercised by the
//    Playwright e2e suite, which round-trips a real .xlsx file.

const SUBJECT_SEPARATOR = ", ";

/**
 * @param {import('./data.js').default} data
 * @returns {{Teachers:object[], Groups:object[], Layers:object[], Deployment:object[], Versions:object[]}}
 */
function dataToSheets(data) {
  return {
    Teachers: data.teachers.map((t) => ({
      id: t.id,
      name: t.name,
      maxPeriods: t.maxPeriods,
      subjects: (t.subjects || []).join(SUBJECT_SEPARATOR),
      isPlaceholder: Boolean(t.isPlaceholder),
    })),
    Groups: data.groups.map((g) => ({
      id: g.id,
      level: g.level,
      block: g.block,
      label: g.label,
      periods: g.periods,
      band: g.band || "",
      teachersNeeded: g.teachersNeeded,
      category: g.category || "",
      note: g.note || "",
    })),
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
 * @param {{Teachers?:object[], Groups?:object[], Layers?:object[], Deployment?:object[], Versions?:object[]}} sheets
 * @returns {import('./data.js').default}
 */
function sheetsToData(sheets) {
  const teachers = (sheets.Teachers || []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    maxPeriods: toNumber(row.maxPeriods),
    subjects: splitList(row.subjects),
    ...(toBool(row.isPlaceholder) ? { isPlaceholder: true } : {}),
  }));

  const groups = (sheets.Groups || []).map((row) => ({
    id: String(row.id),
    level: toNumber(row.level),
    block: String(row.block),
    label: String(row.label),
    periods: toNumber(row.periods),
    band: row.band ? String(row.band) : null,
    teachersNeeded: toNumber(row.teachersNeeded),
    category: row.category ? String(row.category) : "",
    note: row.note ? String(row.note) : "",
  }));

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

  return { teachers, groups, assignments, layerSettings, versions };
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
  XLSX.writeFile(workbook, filename);
}

/**
 * Reads an .xlsx File (e.g. from an <input type="file">) into a data object.
 * Browser-only.
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

export { dataToSheets, sheetsToData, exportWorkbook, importWorkbook, getXLSX };
