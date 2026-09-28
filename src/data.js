// Data model, validation, and localStorage persistence for the deployment solver.
// Pure functions where possible so they're easy to unit test without a browser.

/** @typedef {{id:string, name:string, maxPeriods:number, subjects:string[], isPlaceholder?:boolean}} Teacher */
/** @typedef {{id:string, level:number, block:string, label:string, periods:number, band:string|null, teachersNeeded:number, category:string, note:string}} Group */
/** @typedef {{groupId:string, teacherId:string, locked:boolean}} Assignment */
/** @typedef {{id:string, enabled:boolean, weight:number}} LayerSetting */
/** @typedef {{name:string, timestamp:string, assignments:Assignment[], layerSettings:LayerSetting[]}} Version */

const STORAGE_KEY = "deploymentBuddy.v1";

/** Canonical empty state. */
function emptyData() {
  return {
    teachers: /** @type {Teacher[]} */ ([]),
    groups: /** @type {Group[]} */ ([]),
    assignments: /** @type {Assignment[]} */ ([]),
    layerSettings: /** @type {LayerSetting[]} */ ([]),
    versions: /** @type {Version[]} */ ([]),
  };
}

/**
 * Validate the shape of a data object. Returns a list of human-readable
 * problems; empty list means valid. Never throws.
 * @param {any} data
 * @returns {string[]}
 */
function validate(data) {
  const errors = [];
  if (!data || typeof data !== "object") {
    return ["Data must be an object."];
  }

  const teachers = data.teachers;
  if (!Array.isArray(teachers)) {
    errors.push("teachers must be an array.");
  } else {
    const seenIds = new Set();
    teachers.forEach((t, i) => {
      if (!t || typeof t !== "object") {
        errors.push(`teachers[${i}] must be an object.`);
        return;
      }
      if (!t.id || typeof t.id !== "string")
        errors.push(`teachers[${i}].id must be a non-empty string.`);
      else if (seenIds.has(t.id))
        errors.push(`teachers[${i}].id "${t.id}" is duplicated.`);
      else seenIds.add(t.id);
      if (!t.name || typeof t.name !== "string")
        errors.push(`teachers[${i}].name must be a non-empty string.`);
      if (typeof t.maxPeriods !== "number" || t.maxPeriods < 0)
        errors.push(`teachers[${i}].maxPeriods must be a non-negative number.`);
      if (!Array.isArray(t.subjects))
        errors.push(`teachers[${i}].subjects must be an array.`);
    });
  }

  const groups = data.groups;
  if (!Array.isArray(groups)) {
    errors.push("groups must be an array.");
  } else {
    const seenIds = new Set();
    groups.forEach((g, i) => {
      if (!g || typeof g !== "object") {
        errors.push(`groups[${i}] must be an object.`);
        return;
      }
      if (!g.id || typeof g.id !== "string")
        errors.push(`groups[${i}].id must be a non-empty string.`);
      else if (seenIds.has(g.id))
        errors.push(`groups[${i}].id "${g.id}" is duplicated.`);
      else seenIds.add(g.id);
      if (typeof g.level !== "number")
        errors.push(`groups[${i}].level must be a number.`);
      if (!g.block || typeof g.block !== "string")
        errors.push(`groups[${i}].block must be a non-empty string.`);
      if (!g.label || typeof g.label !== "string")
        errors.push(`groups[${i}].label must be a non-empty string.`);
      if (typeof g.periods !== "number" || g.periods <= 0)
        errors.push(`groups[${i}].periods must be a positive number.`);
      if (
        g.band !== null &&
        typeof g.band !== "undefined" &&
        typeof g.band !== "string"
      )
        errors.push(`groups[${i}].band must be a string or null.`);
      if (typeof g.teachersNeeded !== "number" || g.teachersNeeded < 1)
        errors.push(`groups[${i}].teachersNeeded must be >= 1.`);
    });
  }

  // Cross-reference checks only if both arrays are structurally valid so far.
  if (Array.isArray(teachers) && Array.isArray(groups)) {
    const teacherIds = new Set(teachers.map((t) => t && t.id).filter(Boolean));
    const groupIds = new Set(groups.map((g) => g && g.id).filter(Boolean));
    if (Array.isArray(data.assignments)) {
      data.assignments.forEach((a, i) => {
        if (!a || typeof a !== "object") {
          errors.push(`assignments[${i}] must be an object.`);
          return;
        }
        if (!teacherIds.has(a.teacherId))
          errors.push(
            `assignments[${i}].teacherId "${a.teacherId}" does not match any teacher.`,
          );
        if (!groupIds.has(a.groupId))
          errors.push(
            `assignments[${i}].groupId "${a.groupId}" does not match any group.`,
          );
      });
    } else if (typeof data.assignments !== "undefined") {
      errors.push("assignments must be an array.");
    }
  }

  if (
    typeof data.layerSettings !== "undefined" &&
    !Array.isArray(data.layerSettings)
  ) {
    errors.push("layerSettings must be an array.");
  }
  if (typeof data.versions !== "undefined" && !Array.isArray(data.versions)) {
    errors.push("versions must be an array.");
  }

  return errors;
}

/**
 * Load data from localStorage. Returns emptyData() on any failure
 * (missing key, corrupt JSON, invalid shape, or no localStorage available).
 * @param {Storage} [storage]
 * @returns {ReturnType<typeof emptyData>}
 */
function loadFromStorage(storage) {
  try {
    const store =
      storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return emptyData();
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw);
    const errors = validate(parsed);
    if (errors.length > 0) {
      console.warn(
        "Stored deployment data failed validation, starting fresh:",
        errors,
      );
      return emptyData();
    }
    return parsed;
  } catch (err) {
    console.warn(
      "Failed to load deployment data from storage, starting fresh:",
      err,
    );
    return emptyData();
  }
}

/**
 * Save data to localStorage. Returns true on success, false on failure
 * (quota exceeded, no localStorage, etc). Never throws.
 * @param {any} data
 * @param {Storage} [storage]
 * @returns {boolean}
 */
function saveToStorage(data, storage) {
  try {
    const store =
      storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return false;
    store.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn("Failed to save deployment data to storage:", err);
    return false;
  }
}

export { emptyData, validate, loadFromStorage, saveToStorage, STORAGE_KEY };
