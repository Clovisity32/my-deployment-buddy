// Data model and validation for the deployment solver. Persistence lives in
// src/ui/store.js (Firestore-backed). Pure functions where possible so
// they're easy to unit test without a browser.

/** @typedef {{id:string, name:string, maxPeriods:number|null}} Role */
/** @typedef {{id:string, name:string, discipline:string, stream:string, periods:number, levels:number[]}} Subject */
/** @typedef {{id:string, level:number, name:string, subjectIds:string[]}} SchoolClass */
/** @typedef {{subjectId:string, groups:number}} BandSubject */
/** @typedef {{id:string, name:string, classIds:string[], subjects:BandSubject[], note:string}} Band */
/** @typedef {{label?:string, teachersNeeded?:number, note?:string}} GroupOverride */
/** @typedef {{id:string, name:string, roleId:string, capOverride:number|null, qualifications:string[], isPlaceholder?:boolean}} Teacher */
/**
 * @typedef {{
 *   id:string, level:number, block:string, label:string, periods:number,
 *   band:string|null, teachersNeeded:number, category:string, note:string,
 *   subjectId?:string|null, discipline?:string, stream?:string,
 *   classIds?:string[], bandId?:string|null
 * }} Group
 */
/** @typedef {Group & {subjectId:string|null}} CustomGroup */
/** @typedef {{groupId:string, teacherId:string, locked:boolean}} Assignment */
/** @typedef {{id:string, enabled:boolean, weight:number}} LayerSetting */
/** @typedef {{name:string, timestamp:string, assignments:Assignment[], layerSettings:LayerSetting[]}} Version */

/** Canonical empty state. */
function emptyData() {
  return {
    roles: /** @type {Role[]} */ ([]),
    subjects: /** @type {Subject[]} */ ([]),
    classes: /** @type {SchoolClass[]} */ ([]),
    bands: /** @type {Band[]} */ ([]),
    teachers: /** @type {Teacher[]} */ ([]),
    groups: /** @type {Group[]} */ ([]),
    groupOverrides: /** @type {Record<string, GroupOverride>} */ ({}),
    customGroups: /** @type {CustomGroup[]} */ ([]),
    assignments: /** @type {Assignment[]} */ ([]),
    layerSettings: /** @type {LayerSetting[]} */ ([]),
    versions: /** @type {Version[]} */ ([]),
  };
}

/**
 * Effective 2-week period cap for a teacher: an explicit per-teacher
 * override wins, otherwise fall back to their role's cap (which may itself
 * be null for the "Others" role, resolving to 0 = no cap entered yet).
 * @param {any} data
 * @param {any} teacher
 * @returns {number}
 */
function effectiveCap(data, teacher) {
  if (!teacher || typeof teacher !== "object") return 0;
  const roles = data && Array.isArray(data.roles) ? data.roles : [];
  const role = roles.find((r) => r && r.id === teacher.roleId);
  return teacher.capOverride ?? role?.maxPeriods ?? 0;
}

/**
 * Validate the shape of a Group-like object (used for both `groups` and
 * `customGroups`, which share the same required fields). Pushes messages
 * onto `errors` using `arrayName[i]` as the prefix.
 * @param {any} g
 * @param {number} i
 * @param {string} arrayName
 * @param {string[]} errors
 * @param {Set<string>} seenIds
 */
function validateGroupShape(g, i, arrayName, errors, seenIds) {
  if (!g || typeof g !== "object") {
    errors.push(`${arrayName}[${i}] must be an object.`);
    return;
  }
  if (!g.id || typeof g.id !== "string")
    errors.push(`${arrayName}[${i}].id must be a non-empty string.`);
  else if (seenIds.has(g.id))
    errors.push(`${arrayName}[${i}].id "${g.id}" is duplicated.`);
  else seenIds.add(g.id);
  if (typeof g.level !== "number")
    errors.push(`${arrayName}[${i}].level must be a number.`);
  if (!g.block || typeof g.block !== "string")
    errors.push(`${arrayName}[${i}].block must be a non-empty string.`);
  if (!g.label || typeof g.label !== "string")
    errors.push(`${arrayName}[${i}].label must be a non-empty string.`);
  if (typeof g.periods !== "number" || g.periods <= 0)
    errors.push(`${arrayName}[${i}].periods must be a positive number.`);
  if (
    g.band !== null &&
    typeof g.band !== "undefined" &&
    typeof g.band !== "string"
  )
    errors.push(`${arrayName}[${i}].band must be a string or null.`);
  if (typeof g.teachersNeeded !== "number" || g.teachersNeeded < 1)
    errors.push(`${arrayName}[${i}].teachersNeeded must be >= 1.`);
  // New (schema v2) fields are optional so v1-shaped and mid-migration data
  // stays valid — only type-check them when present.
  if (
    typeof g.subjectId !== "undefined" &&
    g.subjectId !== null &&
    typeof g.subjectId !== "string"
  )
    errors.push(`${arrayName}[${i}].subjectId must be a string or null.`);
  if (typeof g.discipline !== "undefined" && typeof g.discipline !== "string")
    errors.push(`${arrayName}[${i}].discipline must be a string.`);
  if (typeof g.stream !== "undefined" && typeof g.stream !== "string")
    errors.push(`${arrayName}[${i}].stream must be a string.`);
  if (typeof g.classIds !== "undefined" && !Array.isArray(g.classIds))
    errors.push(`${arrayName}[${i}].classIds must be an array.`);
  if (
    typeof g.bandId !== "undefined" &&
    g.bandId !== null &&
    typeof g.bandId !== "string"
  )
    errors.push(`${arrayName}[${i}].bandId must be a string or null.`);
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

  const roles = data.roles;
  if (typeof roles !== "undefined") {
    if (!Array.isArray(roles)) {
      errors.push("roles must be an array.");
    } else {
      const seenIds = new Set();
      roles.forEach((r, i) => {
        if (!r || typeof r !== "object") {
          errors.push(`roles[${i}] must be an object.`);
          return;
        }
        if (!r.id || typeof r.id !== "string")
          errors.push(`roles[${i}].id must be a non-empty string.`);
        else if (seenIds.has(r.id))
          errors.push(`roles[${i}].id "${r.id}" is duplicated.`);
        else seenIds.add(r.id);
        if (!r.name || typeof r.name !== "string")
          errors.push(`roles[${i}].name must be a non-empty string.`);
        if (r.maxPeriods !== null && typeof r.maxPeriods !== "number")
          errors.push(`roles[${i}].maxPeriods must be a number or null.`);
      });
    }
  }

  const subjects = data.subjects;
  if (typeof subjects !== "undefined") {
    if (!Array.isArray(subjects)) {
      errors.push("subjects must be an array.");
    } else {
      const seenIds = new Set();
      subjects.forEach((s, i) => {
        if (!s || typeof s !== "object") {
          errors.push(`subjects[${i}] must be an object.`);
          return;
        }
        if (!s.id || typeof s.id !== "string")
          errors.push(`subjects[${i}].id must be a non-empty string.`);
        else if (seenIds.has(s.id))
          errors.push(`subjects[${i}].id "${s.id}" is duplicated.`);
        else seenIds.add(s.id);
        if (!s.name || typeof s.name !== "string")
          errors.push(`subjects[${i}].name must be a non-empty string.`);
        if (
          typeof s.discipline !== "undefined" &&
          typeof s.discipline !== "string"
        )
          errors.push(`subjects[${i}].discipline must be a string.`);
        if (typeof s.stream !== "undefined" && typeof s.stream !== "string")
          errors.push(`subjects[${i}].stream must be a string.`);
        if (typeof s.periods !== "number" || s.periods <= 0)
          errors.push(`subjects[${i}].periods must be a positive number.`);
        if (typeof s.levels !== "undefined" && !Array.isArray(s.levels))
          errors.push(`subjects[${i}].levels must be an array.`);
      });
    }
  }

  const classes = data.classes;
  if (typeof classes !== "undefined") {
    if (!Array.isArray(classes)) {
      errors.push("classes must be an array.");
    } else {
      const seenIds = new Set();
      classes.forEach((c, i) => {
        if (!c || typeof c !== "object") {
          errors.push(`classes[${i}] must be an object.`);
          return;
        }
        if (!c.id || typeof c.id !== "string")
          errors.push(`classes[${i}].id must be a non-empty string.`);
        else if (seenIds.has(c.id))
          errors.push(`classes[${i}].id "${c.id}" is duplicated.`);
        else seenIds.add(c.id);
        if (typeof c.level !== "number")
          errors.push(`classes[${i}].level must be a number.`);
        if (!c.name || typeof c.name !== "string")
          errors.push(`classes[${i}].name must be a non-empty string.`);
        if (typeof c.subjectIds !== "undefined" && !Array.isArray(c.subjectIds))
          errors.push(`classes[${i}].subjectIds must be an array.`);
      });
    }
  }

  const bands = data.bands;
  if (typeof bands !== "undefined") {
    if (!Array.isArray(bands)) {
      errors.push("bands must be an array.");
    } else {
      const seenIds = new Set();
      bands.forEach((b, i) => {
        if (!b || typeof b !== "object") {
          errors.push(`bands[${i}] must be an object.`);
          return;
        }
        if (!b.id || typeof b.id !== "string")
          errors.push(`bands[${i}].id must be a non-empty string.`);
        else if (seenIds.has(b.id))
          errors.push(`bands[${i}].id "${b.id}" is duplicated.`);
        else seenIds.add(b.id);
        if (!b.name || typeof b.name !== "string")
          errors.push(`bands[${i}].name must be a non-empty string.`);
        if (typeof b.classIds !== "undefined" && !Array.isArray(b.classIds))
          errors.push(`bands[${i}].classIds must be an array.`);
        if (typeof b.subjects !== "undefined") {
          if (!Array.isArray(b.subjects)) {
            errors.push(`bands[${i}].subjects must be an array.`);
          } else {
            b.subjects.forEach((entry, j) => {
              if (!entry || typeof entry !== "object") {
                errors.push(`bands[${i}].subjects[${j}] must be an object.`);
                return;
              }
              if (!entry.subjectId || typeof entry.subjectId !== "string")
                errors.push(
                  `bands[${i}].subjects[${j}].subjectId must be a non-empty string.`,
                );
              if (typeof entry.groups !== "number" || entry.groups < 1)
                errors.push(`bands[${i}].subjects[${j}].groups must be >= 1.`);
            });
          }
        }
      });
    }
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
      // roleId/capOverride/qualifications are new in schema v2 — optional so
      // v1-shaped and mid-migration data stays valid; type-check if present.
      if (typeof t.roleId !== "undefined" && typeof t.roleId !== "string")
        errors.push(`teachers[${i}].roleId must be a string.`);
      if (
        typeof t.capOverride !== "undefined" &&
        t.capOverride !== null &&
        typeof t.capOverride !== "number"
      )
        errors.push(`teachers[${i}].capOverride must be a number or null.`);
      if (
        typeof t.qualifications !== "undefined" &&
        !Array.isArray(t.qualifications)
      )
        errors.push(`teachers[${i}].qualifications must be an array.`);
    });

    // Cross-reference: a teacher's roleId should point at a real role, but
    // only once roles are actually in use — roleId itself stays optional so
    // v1 / mid-migration data (no roles yet) isn't punished for lacking it.
    if (Array.isArray(roles) && roles.length > 0) {
      const roleIds = new Set(roles.map((r) => r && r.id).filter(Boolean));
      teachers.forEach((t, i) => {
        if (
          t &&
          typeof t === "object" &&
          typeof t.roleId === "string" &&
          t.roleId
        ) {
          if (!roleIds.has(t.roleId))
            errors.push(
              `teachers[${i}].roleId "${t.roleId}" does not match any role.`,
            );
        }
      });
    }
  }

  const groups = data.groups;
  if (!Array.isArray(groups)) {
    errors.push("groups must be an array.");
  } else {
    const seenIds = new Set();
    groups.forEach((g, i) =>
      validateGroupShape(g, i, "groups", errors, seenIds),
    );
  }

  const customGroups = data.customGroups;
  if (typeof customGroups !== "undefined") {
    if (!Array.isArray(customGroups)) {
      errors.push("customGroups must be an array.");
    } else {
      const seenIds = new Set();
      customGroups.forEach((g, i) =>
        validateGroupShape(g, i, "customGroups", errors, seenIds),
      );
    }
  }

  const groupOverrides = data.groupOverrides;
  if (typeof groupOverrides !== "undefined") {
    if (
      !groupOverrides ||
      typeof groupOverrides !== "object" ||
      Array.isArray(groupOverrides)
    ) {
      errors.push("groupOverrides must be an object.");
    } else {
      Object.entries(groupOverrides).forEach(([groupId, override]) => {
        if (!override || typeof override !== "object") {
          errors.push(`groupOverrides["${groupId}"] must be an object.`);
          return;
        }
        if (
          typeof override.label !== "undefined" &&
          typeof override.label !== "string"
        )
          errors.push(`groupOverrides["${groupId}"].label must be a string.`);
        if (
          typeof override.teachersNeeded !== "undefined" &&
          (typeof override.teachersNeeded !== "number" ||
            override.teachersNeeded < 1)
        )
          errors.push(
            `groupOverrides["${groupId}"].teachersNeeded must be >= 1.`,
          );
        if (
          typeof override.note !== "undefined" &&
          typeof override.note !== "string"
        )
          errors.push(`groupOverrides["${groupId}"].note must be a string.`);
      });
    }
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
 * Migrate a v1-shaped data object (flat teacher.maxPeriods, no roles/
 * subjects/classes/bands) into schema v2. Never throws. Anything already
 * shaped like v2 (or garbage) is passed through with the new fields
 * defaulted, so this is safe to call speculatively.
 * @param {any} data
 * @returns {ReturnType<typeof emptyData>}
 */
function migrateV1(data) {
  const src = data && typeof data === "object" ? data : {};

  const roles = [
    { id: "hod", name: "HOD", maxPeriods: 36 },
    { id: "sh_st", name: "SH/ST", maxPeriods: 50 },
    { id: "teacher", name: "Teacher", maxPeriods: 60 },
    { id: "others", name: "Others", maxPeriods: null },
  ];

  // v1 had no structured subject/qualification model: a teacher's free-text
  // `subjects` list (e.g. ["LSS", "Chem"]) was matched directly against a
  // group's free-text `block` string (e.g. "Chem") to decide who could teach
  // what. Schema v2 replaces that with subjectId-based qualifications, but to
  // reproduce v1's exact qualification semantics for existing HOD data we
  // reuse the old free-text values as a 1:1 stand-in: each migrated
  // teacher's qualifications = their old `subjects` array, and each migrated
  // group's subjectId = its own `block` string. Without this, every migrated
  // group would have zero qualified teachers post-migration (qualification.js
  // fails closed on a missing subjectId) and a real deployment would become
  // permanently unsolvable on upgrade with no indication why.
  const v1Teachers = Array.isArray(src.teachers) ? src.teachers : [];
  const teachers = v1Teachers.map((t) => {
    const base = t && typeof t === "object" ? t : {};
    const { maxPeriods, ...rest } = base;
    return {
      ...rest,
      roleId: "others",
      capOverride: typeof maxPeriods === "number" ? maxPeriods : null,
      qualifications: Array.isArray(rest.subjects) ? [...rest.subjects] : [],
    };
  });

  const v1Groups = Array.isArray(src.groups) ? src.groups : [];
  // The groups that stay in `data.groups` (untouched by design otherwise)
  // also get the same block->subjectId stand-in stamped on, so a migrated
  // teacher qualified for "Chem" matches a migrated group whose block was
  // "Chem" - exactly reproducing v1 qualification behaviour.
  const groups = v1Groups.map((g) => {
    const base = g && typeof g === "object" ? g : {};
    return {
      ...base,
      subjectId: typeof base.block === "string" ? base.block : null,
    };
  });
  const customGroups = v1Groups.map((g) => ({
    ...(g && typeof g === "object" ? g : {}),
    subjectId: null,
  }));

  return {
    ...src,
    roles,
    subjects: [],
    classes: [],
    bands: [],
    teachers,
    groups,
    groupOverrides: {},
    customGroups,
    assignments: Array.isArray(src.assignments) ? src.assignments : [],
    layerSettings: Array.isArray(src.layerSettings) ? src.layerSettings : [],
    versions: Array.isArray(src.versions) ? src.versions : [],
  };
}

export { emptyData, validate, migrateV1, effectiveCap };
