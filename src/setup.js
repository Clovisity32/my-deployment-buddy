// Pure school-structure helpers: turn roles/subjects/classes/bands into the
// generated teaching groups the solver and views consume. No DOM
// dependency — runs the same under `node --test` and in the browser.

/**
 * The default class-name pattern the school reuses every year
 * (e.g. "1 Curiosity (101)" … "1 Contribute (108)").
 * @returns {string[]}
 */
function defaultClassNames() {
  return [
    "Curiosity",
    "Adaptability",
    "Respect",
    "Responsibility",
    "Resilience",
    "Care",
    "Connect",
    "Contribute",
    "Flourish",
  ];
}

/**
 * Generate the `classes` array for the given per-level counts, preserving
 * any existing class's `name`/`subjectIds` edits when it's regenerated.
 * @param {Record<number|string, number>} countsByLevel
 * @param {string[]} names
 * @param {any[]} existing
 * @returns {any[]}
 */
function generateClasses(countsByLevel, names, existing) {
  const existingById = new Map(
    (Array.isArray(existing) ? existing : [])
      .filter((c) => c && typeof c.id === "string")
      .map((c) => [c.id, c]),
  );
  const levelsPresent = new Set(
    Object.keys(countsByLevel || {}).map((lvl) => Number(lvl)),
  );

  const generated = [];
  const levels = Object.keys(countsByLevel || {})
    .map(Number)
    .sort((a, b) => a - b);

  levels.forEach((level) => {
    const count = countsByLevel[level] ?? 0;
    for (let i = 0; i < count; i++) {
      const id = String(level * 100 + i + 1);
      const name =
        Array.isArray(names) && names.length > 0 ? names[i % names.length] : "";
      const prior = existingById.get(id);
      if (prior) {
        generated.push({
          id,
          level,
          name: prior.name,
          subjectIds: Array.isArray(prior.subjectIds) ? prior.subjectIds : [],
        });
      } else {
        generated.push({ id, level, name, subjectIds: [] });
      }
    }
  });

  // Classes at levels not touched by this call are preserved untouched.
  const untouched = (Array.isArray(existing) ? existing : []).filter(
    (c) => c && !levelsPresent.has(Number(c.level)),
  );

  return [...generated, ...untouched];
}

/** @param {string} discipline */
function blockFromDiscipline(discipline) {
  switch (discipline) {
    case "PHY":
      return "Phy";
    case "CHEM":
      return "Chem";
    case "BIO":
      return "Bio";
    case "LSS":
      return "LSS";
    case "SCI":
      return "SCI";
    default:
      return discipline;
  }
}

/**
 * Generate the deterministic list of teaching groups from roles/subjects/
 * classes/bands, then apply groupOverrides and append customGroups.
 * @param {any} data
 * @returns {any[]}
 */
function generateGroups(data) {
  const subjects = Array.isArray(data.subjects) ? data.subjects : [];
  const classes = Array.isArray(data.classes) ? data.classes : [];
  const bands = Array.isArray(data.bands) ? data.bands : [];
  const groupOverrides =
    data.groupOverrides && typeof data.groupOverrides === "object"
      ? data.groupOverrides
      : {};
  const customGroups = Array.isArray(data.customGroups)
    ? data.customGroups
    : [];

  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const classById = new Map(classes.map((c) => [c.id, c]));

  // (classId, subjectId) pairs covered by a band, and which band covers them.
  const coveredBy = new Map(); // key `${classId}::${subjectId}` -> band
  bands.forEach((band) => {
    const classIds = Array.isArray(band.classIds) ? band.classIds : [];
    const bandSubjects = Array.isArray(band.subjects) ? band.subjects : [];
    bandSubjects.forEach((entry) => {
      classIds.forEach((classId) => {
        coveredBy.set(`${classId}::${entry.subjectId}`, band);
      });
    });
  });

  const generated = [];

  // Sort classes by level, then keep declared order within a level.
  const sortedClasses = [...classes].sort((a, b) => a.level - b.level);

  sortedClasses.forEach((cls) => {
    const subjectIds = Array.isArray(cls.subjectIds) ? cls.subjectIds : [];
    // Iterate subjects in the order they appear in data.subjects for a
    // deterministic, stable secondary order.
    subjects.forEach((subject) => {
      if (!subjectIds.includes(subject.id)) return;
      if (coveredBy.has(`${cls.id}::${subject.id}`)) return; // handled by band pass below
      generated.push({
        id: `g_${subject.id}_${cls.id}`,
        level: cls.level,
        block: blockFromDiscipline(subject.discipline),
        label: `${cls.id} ${subject.name}`,
        periods: subject.periods,
        band: null,
        teachersNeeded: 1,
        category: subject.stream,
        note: "",
        subjectId: subject.id,
        discipline: subject.discipline,
        stream: subject.stream,
        classIds: [cls.id],
        bandId: null,
      });
    });
  });

  // Bands, in declared order; subjects within a band in declared order.
  const sortedBands = [...bands].sort((a, b) => {
    const levelA = memberLevel(a, classById);
    const levelB = memberLevel(b, classById);
    return levelA - levelB;
  });

  sortedBands.forEach((band) => {
    const classIds = Array.isArray(band.classIds) ? band.classIds : [];
    const bandSubjects = Array.isArray(band.subjects) ? band.subjects : [];
    const level = memberLevel(band, classById);
    bandSubjects.forEach((entry) => {
      const subject = subjectById.get(entry.subjectId);
      if (!subject) return;
      const n = entry.groups;
      const note = `Banded: ${classIds.join(", ")}`;
      if (n === 1) {
        generated.push({
          id: `g_${subject.id}_${band.id}`,
          level,
          block: blockFromDiscipline(subject.discipline),
          label: `${classIds.join(" & ")} ${subject.name}`,
          periods: subject.periods,
          band: band.id,
          teachersNeeded: 1,
          category: subject.stream,
          note,
          subjectId: subject.id,
          discipline: subject.discipline,
          stream: subject.stream,
          classIds,
          bandId: band.id,
        });
      } else {
        for (let k = 1; k <= n; k++) {
          generated.push({
            id: `g_${subject.id}_${band.id}_${k}`,
            level,
            block: blockFromDiscipline(subject.discipline),
            label: `${band.name} ${subject.name} Grp ${k}`,
            periods: subject.periods,
            band: band.id,
            teachersNeeded: 1,
            category: subject.stream,
            note,
            subjectId: subject.id,
            discipline: subject.discipline,
            stream: subject.stream,
            classIds,
            bandId: band.id,
          });
        }
      }
    });
  });

  const withOverrides = generated.map((g) => {
    const override = groupOverrides[g.id];
    if (!override) return g;
    return {
      ...g,
      ...(typeof override.label !== "undefined"
        ? { label: override.label }
        : {}),
      ...(typeof override.teachersNeeded !== "undefined"
        ? { teachersNeeded: override.teachersNeeded }
        : {}),
      ...(typeof override.note !== "undefined" ? { note: override.note } : {}),
    };
  });

  return [...withOverrides, ...customGroups];
}

/** @param {any} band @param {Map<string, any>} classById */
function memberLevel(band, classById) {
  const classIds = Array.isArray(band.classIds) ? band.classIds : [];
  for (const id of classIds) {
    const cls = classById.get(id);
    if (cls && typeof cls.level === "number") return cls.level;
  }
  return 0;
}

/**
 * Plain-language warnings about the current school-structure setup. Never
 * throws; returns [] when there's nothing to flag.
 * @param {any} data
 * @returns {string[]}
 */
function setupWarnings(data) {
  const warnings = [];
  try {
    const roles = Array.isArray(data.roles) ? data.roles : [];
    const subjects = Array.isArray(data.subjects) ? data.subjects : [];
    const classes = Array.isArray(data.classes) ? data.classes : [];
    const bands = Array.isArray(data.bands) ? data.bands : [];
    const teachers = Array.isArray(data.teachers) ? data.teachers : [];

    const subjectById = new Map(subjects.map((s) => [s.id, s]));
    const classById = new Map(classes.map((c) => [c.id, c]));
    const roleById = new Map(roles.map((r) => [r.id, r]));

    // A class takes a subject not offered at its level.
    classes.forEach((cls) => {
      const subjectIds = Array.isArray(cls.subjectIds) ? cls.subjectIds : [];
      subjectIds.forEach((subjectId) => {
        const subject = subjectById.get(subjectId);
        if (!subject) return;
        const levels = Array.isArray(subject.levels) ? subject.levels : [];
        if (!levels.includes(cls.level)) {
          warnings.push(
            `Class "${cls.id}" is set to take "${subject.name}", which isn't offered at level ${cls.level}.`,
          );
        }
      });
    });

    // A (class, subject) pair banded in more than one band.
    const seenPairs = new Map(); // key -> count
    bands.forEach((band) => {
      const classIds = Array.isArray(band.classIds) ? band.classIds : [];
      const bandSubjects = Array.isArray(band.subjects) ? band.subjects : [];
      bandSubjects.forEach((entry) => {
        classIds.forEach((classId) => {
          const key = `${classId}::${entry.subjectId}`;
          seenPairs.set(key, (seenPairs.get(key) || 0) + 1);
        });
      });
    });
    seenPairs.forEach((count, key) => {
      if (count > 1) {
        const [classId, subjectId] = key.split("::");
        const subject = subjectById.get(subjectId);
        const subjectName = subject ? subject.name : subjectId;
        warnings.push(
          `Class "${classId}" and subject "${subjectName}" are banded in more than one band.`,
        );
      }
    });

    // A band subject entry none of the band's classes actually take.
    bands.forEach((band) => {
      const classIds = Array.isArray(band.classIds) ? band.classIds : [];
      const bandSubjects = Array.isArray(band.subjects) ? band.subjects : [];
      bandSubjects.forEach((entry) => {
        const subject = subjectById.get(entry.subjectId);
        const subjectName = subject ? subject.name : entry.subjectId;
        const anyTakesIt = classIds.some((classId) => {
          const cls = classById.get(classId);
          const subjectIds =
            cls && Array.isArray(cls.subjectIds) ? cls.subjectIds : [];
          return subjectIds.includes(entry.subjectId);
        });
        if (!anyTakesIt) {
          warnings.push(
            `Band "${band.name}" is set up for "${subjectName}" but none of its classes take that subject.`,
          );
        }
      });
    });

    // An "Others" teacher with no cap entered.
    teachers.forEach((teacher) => {
      const role = roleById.get(teacher.roleId);
      if (role && role.maxPeriods === null) {
        if (
          teacher.capOverride === null ||
          typeof teacher.capOverride === "undefined"
        ) {
          warnings.push(
            `Teacher "${teacher.name}" has an "Others" role and needs a maximum-periods cap entered.`,
          );
        }
      }
    });

    // Exact big + small counts that already exceed the teacher's own max.
    teachers.forEach((teacher) => {
      const fixed = (teacher.bigCount ?? 0) + (teacher.smallCount ?? 0);
      if (typeof teacher.maxGroups === "number" && fixed > teacher.maxGroups) {
        warnings.push(
          `Teacher "${teacher.name}" has ${fixed} big and small group(s) set, which is more than their maximum of ${teacher.maxGroups} group(s).`,
        );
      }
    });
  } catch {
    // never throw — return whatever we'd collected so far.
  }
  return warnings;
}

/**
 * Regenerate `groups` from the current school structure and drop any
 * assignment whose group no longer exists. Pure — the caller decides when
 * to call this (setup edits only, never on load/solve).
 * @param {any} data
 * @returns {{data: any, droppedCount: number}}
 */
function rebuildGroups(data) {
  const newGroups = generateGroups(data);
  const newGroupIds = new Set(newGroups.map((g) => g.id));
  const assignments = Array.isArray(data.assignments) ? data.assignments : [];
  const kept = assignments.filter((a) => newGroupIds.has(a.groupId));
  const droppedCount = assignments.length - kept.length;
  // Also drop any groupOverride keyed by a group id that no longer exists
  // after regeneration (e.g. a band's per-subject group count shrank) - left
  // as-is it becomes a permanently orphaned, invisible dead entry.
  const groupOverrides = Object.fromEntries(
    Object.entries(data.groupOverrides || {}).filter(([groupId]) =>
      newGroupIds.has(groupId),
    ),
  );
  const newData = {
    ...data,
    groups: newGroups,
    assignments: kept,
    groupOverrides,
  };
  return { data: newData, droppedCount };
}

export {
  defaultClassNames,
  generateClasses,
  generateGroups,
  setupWarnings,
  rebuildGroups,
};
