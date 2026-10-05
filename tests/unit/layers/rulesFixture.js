// Shared by the new-rule layer tests. Groups default to Sec 3, stream G2,
// 6 periods, one teacher needed; teachers default to a 100-period cap.
export const OFF = (id) => ({ id, enabled: false, weight: 0 });
export const ON = (id, weight) => ({ id, enabled: true, weight });
const FAIR_LAYERS = ["classCount", "mix", "preps", "graduatingSpread"];
const KEY = {
  classCount: "classCount",
  mix: "mix",
  preps: "preps",
  graduatingSpread: "graduating",
};
// Soft layers that would otherwise pull the answer around in a test.
export const QUIET = [...FAIR_LAYERS.map(OFF), OFF("balance"), OFF("stable")];

/**
 * Switch every fairness layer off except `layerId`, and give it `level` (1-5)
 * in the fairness setting. Spread into fixture(): `fixture({ ..., ...only("preps", 3) })`.
 */
export function only(layerId, level = 3) {
  const levels = {
    classCount: 1,
    mix: 1,
    preps: 1,
    graduating: 1,
    [KEY[layerId]]: level,
  };
  return {
    layerSettings: [
      ...FAIR_LAYERS.filter((id) => id !== layerId).map(OFF),
      OFF("balance"),
      OFF("stable"),
    ],
    settings: { fairness: { preset: "custom", levels } },
  };
}

export function group(id, subjectId, over = {}) {
  return {
    id,
    level: 3,
    block: subjectId,
    label: id,
    periods: 6,
    band: null,
    bandId: null,
    teachersNeeded: 1,
    subjectId,
    stream: "G2",
    classIds: [],
    ...over,
  };
}

export const teacher = (id, quals, over = {}) => ({
  id,
  name: id,
  roleId: "r",
  capOverride: 100,
  qualifications: quals,
  ...over,
});

export function fixture({
  teachers,
  groups,
  classes = [],
  layerSettings = QUIET,
  assignments = [],
  settings,
  roles = [{ id: "r", name: "R", maxPeriods: null }],
}) {
  const subjectIds = [...new Set(groups.map((g) => g.subjectId))];
  return {
    roles,
    subjects: subjectIds.map((id) => ({
      id,
      name: id,
      discipline: id,
      stream: "G2",
      periods: 6,
      levels: [3],
    })),
    classes,
    bands: [],
    teachers,
    groups,
    assignments,
    layerSettings,
    ...(settings ? { settings } : {}),
  };
}
