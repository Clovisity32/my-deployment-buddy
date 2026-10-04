// Intake: turns the three Excel inputs (form teachers, last year's teachers,
// per-teacher deny list) into validated data. Pure and fail-safe: nothing
// here touches the browser, and a bad row becomes a plain-language problem
// instead of an exception. Pasted text and uploaded files both become rows
// keyed by header name first, so they share one code path (parseIntake).

const KINDS = ["formTeachers", "lastYear", "denies"];

const HEADERS = {
  formTeachers: ["Class", "Form teacher"],
  lastYear: ["Level", "Class", "Subject", "Teacher"],
  denies: ["Teacher", "Level", "Stream", "Subject"],
};

// Fictional, clearly-not-real example rows for the template's Example sheet.
const EXAMPLES = {
  formTeachers: ["301", "Alex Example"],
  lastYear: [3, "301", "G3_SCI_CHEM", "Alex Example"],
  denies: ["Alex Example", 1, "G2", ""],
};

const STREAMS = ["G1", "G2", "G3", "PURE"];
const TITLES = new Set([
  "mr",
  "mrs",
  "ms",
  "mdm",
  "madam",
  "miss",
  "dr",
  "mister",
]);

/** @param {any} text */
function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const compact = (text) => normalize(text).replace(/ /g, "");
const nameTokens = (text) =>
  normalize(text)
    .split(" ")
    .filter((t) => t && !TITLES.has(t));

/** The cell under `header`, matched ignoring case/spacing. */
function pick(row, header) {
  const want = normalize(header);
  const key = Object.keys(row || {}).find((k) => normalize(k) === want);
  return key === undefined ? "" : row[key];
}

const isBlank = (v) => String(v ?? "").trim() === "";
const isBlankRow = (row) => Object.values(row || {}).every(isBlank);

function findTeacher(data, text) {
  const q = nameTokens(text);
  if (q.length === 0) return { error: "The teacher name is blank." };
  const teachers = data.teachers || [];
  const exact = teachers.filter(
    (t) => nameTokens(t.name).join(" ") === q.join(" "),
  );
  if (exact.length === 1) return { id: exact[0].id };
  const pool =
    exact.length > 1
      ? exact
      : teachers.filter((t) => {
          const tokens = nameTokens(t.name);
          return q.every((w) => tokens.includes(w));
        });
  if (pool.length === 1) return { id: pool[0].id };
  if (pool.length > 1)
    return {
      error: `"${String(text).trim()}" matches more than one teacher (${pool.map((t) => t.name).join(", ")}). Use the full name.`,
    };
  return {
    error: `No teacher matches "${String(text).trim()}". Check the spelling against the Teachers table.`,
  };
}

function findClass(data, text) {
  const q = compact(text);
  if (q === "") return { error: "The class is blank." };
  const hits = (data.classes || []).filter((c) =>
    [
      c.id,
      c.name,
      `${c.level}${c.name}`,
      `s${c.level}${c.name}`,
      `sec${c.level}${c.name}`,
    ].some((cand) => compact(cand) === q),
  );
  if (hits.length === 1) return { id: hits[0].id };
  if (hits.length > 1)
    return {
      error: `"${String(text).trim()}" matches more than one class - use the class id (e.g. ${hits[0].id}) or "Sec ${hits[0].level} ${hits[0].name}".`,
    };
  return {
    error: `No class matches "${String(text).trim()}". Use a class id or name from the Classes tab.`,
  };
}

function findSubject(data, text) {
  const q = normalize(text);
  if (q === "") return { error: "The subject is blank." };
  const hits = (data.subjects || []).filter(
    (s) => normalize(s.id) === q || normalize(s.name) === q,
  );
  if (hits.length === 1) return { id: hits[0].id };
  return {
    error: `No subject matches "${String(text).trim()}". Use a subject id or name from the Subjects tab.`,
  };
}

/** @returns {{value?:number|undefined, error?:string}} blank is allowed (value undefined) */
function parseLevel(v) {
  if (isBlank(v)) return { value: undefined };
  const n = Number(String(v).replace(/[^0-9]/g, ""));
  if (Number.isInteger(n) && n >= 1 && n <= 9) return { value: n };
  return {
    error: `"${String(v).trim()}" is not a level. Use a number such as 3 or "Sec 3".`,
  };
}

function parseStream(v) {
  if (isBlank(v)) return { value: undefined };
  const s = String(v).trim().toUpperCase();
  return STREAMS.includes(s)
    ? { value: s }
    : {
        error: `"${String(v).trim()}" is not a stream. Use ${STREAMS.join(", ")} or leave it blank.`,
      };
}

const teacherName = (data, id) =>
  (data.teachers || []).find((t) => t.id === id)?.name ?? id;

function templateRows(kind, data) {
  const headers = HEADERS[kind];
  const example = EXAMPLES[kind];
  let current = [];
  if (kind === "formTeachers") {
    current = (data.classes || [])
      .filter((c) => c.formTeacherId)
      .map((c) => [c.id, teacherName(data, c.formTeacherId)]);
  } else if (kind === "lastYear") {
    current = (data.lastYear || []).map((r) => [
      r.level,
      r.classRef,
      r.subjectId,
      teacherName(data, r.teacherId),
    ]);
  } else if (kind === "denies") {
    current = (data.teachers || []).flatMap((t) =>
      (t.denies || []).map((r) => [
        t.name,
        r.level ?? "",
        r.stream ?? "",
        r.subjectId ?? "",
      ]),
    );
  }
  return { headers, current, example };
}

/** Tab-separated text (what Excel copies) -> rows keyed by header name. */
function rowsFromPaste(kind, text) {
  const headers = HEADERS[kind];
  const cells = String(text ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("\t").map((c) => c.trim()));
  if (cells.length > 0 && normalize(cells[0][0]) === normalize(headers[0]))
    cells.shift();
  return cells.map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])),
  );
}

const PARSERS = {
  formTeachers(row, data, seen) {
    const c = findClass(data, pick(row, "Class"));
    if (c.error) return { error: c.error };
    const t = findTeacher(data, pick(row, "Form teacher"));
    if (t.error) return { error: t.error };
    if (seen.has(c.id))
      return {
        error: `Class ${c.id} is listed twice. Keep one form teacher per class.`,
      };
    seen.add(c.id);
    return { value: { classId: c.id, teacherId: t.id } };
  },
  lastYear(row, data, seen) {
    const level = parseLevel(pick(row, "Level"));
    if (level.error) return { error: level.error };
    if (level.value === undefined) return { error: "The level is blank." };
    const classRef = String(pick(row, "Class") ?? "").trim();
    if (classRef === "") return { error: "The class is blank." };
    const s = findSubject(data, pick(row, "Subject"));
    if (s.error) return { error: s.error };
    const t = findTeacher(data, pick(row, "Teacher"));
    if (t.error) return { error: t.error };
    const key = `${level.value}|${compact(classRef)}|${s.id}`;
    if (seen.has(key))
      return {
        error: `${classRef} ${s.id} is listed twice. Keep one teacher per class and subject.`,
      };
    seen.add(key);
    return {
      value: { level: level.value, classRef, subjectId: s.id, teacherId: t.id },
    };
  },
  denies(row, data) {
    const t = findTeacher(data, pick(row, "Teacher"));
    if (t.error) return { error: t.error };
    const level = parseLevel(pick(row, "Level"));
    if (level.error) return { error: level.error };
    const stream = parseStream(pick(row, "Stream"));
    if (stream.error) return { error: stream.error };
    let subjectId;
    if (!isBlank(pick(row, "Subject"))) {
      const s = findSubject(data, pick(row, "Subject"));
      if (s.error) return { error: s.error };
      subjectId = s.id;
    }
    if (level.value === undefined && !stream.value && !subjectId)
      return {
        error:
          "Say which level, stream or subject to avoid - a blank rule would block nothing.",
      };
    return {
      value: {
        teacherId: t.id,
        rule: {
          ...(level.value !== undefined ? { level: level.value } : {}),
          ...(stream.value ? { stream: stream.value } : {}),
          ...(subjectId ? { subjectId } : {}),
        },
      },
    };
  },
};

const APPLY = {
  formTeachers(data, accepted) {
    return {
      ...data,
      classes: (data.classes || []).map((c) => {
        const { formTeacherId, ...rest } = c;
        const hit = accepted.find((a) => a.classId === c.id);
        return hit ? { ...rest, formTeacherId: hit.teacherId } : rest;
      }),
    };
  },
  lastYear(data, accepted) {
    return { ...data, lastYear: accepted };
  },
  denies(data, accepted) {
    const byTeacher = new Map();
    for (const a of accepted) {
      if (!byTeacher.has(a.teacherId)) byTeacher.set(a.teacherId, []);
      byTeacher.get(a.teacherId).push(a.rule);
    }
    return {
      ...data,
      teachers: (data.teachers || []).map((t) => {
        const { denies, ...rest } = t;
        const rules = byTeacher.get(t.id);
        return rules ? { ...rest, denies: rules } : rest;
      }),
    };
  },
};

/**
 * @param {"formTeachers"|"lastYear"|"denies"} kind
 * @param {object[]} rows  objects keyed by header name
 * @param {any} data
 * @returns {{accepted:object[], problems:{row:number, message:string}[], next:any}}
 *   `row` is the spreadsheet row number (the header is row 1). `next` is the
 *   updated data, or `data` itself when there are problems or nothing to apply.
 */
function parseIntake(kind, rows, data) {
  const parser = PARSERS[kind];
  const accepted = [];
  const problems = [];
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row, i) => {
    if (isBlankRow(row)) return;
    const res = parser
      ? parser(row, data || {}, seen)
      : { error: "Unknown kind." };
    if (res.error) problems.push({ row: i + 2, message: res.error });
    else accepted.push(res.value);
  });
  const next =
    problems.length > 0 || accepted.length === 0
      ? data
      : APPLY[kind](data, accepted);
  return { accepted, problems, next };
}

export {
  KINDS,
  HEADERS,
  EXAMPLES,
  normalize,
  templateRows,
  rowsFromPaste,
  parseIntake,
};
