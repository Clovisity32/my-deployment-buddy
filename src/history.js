// Undo/redo history for the Board. Pure (no DOM, no store) so it can be tested
// under `node --test`. A snapshot holds only the board-owned slice (groups,
// assignments, groupsFrozen), so undoing never reverts edits made on other
// tabs. History belongs to ONE deployment: whenever the whole dataset is
// replaced (load sample, Excel import, version restore, rebuild) the caller
// must call reset(), otherwise Undo could write the previous school's groups
// into the new one.

const DEFAULT_MAX = 50;

/** @param {any} d */
function snap(d) {
  const s = { groups: d.groups, assignments: d.assignments };
  if (d.groupsFrozen !== undefined) s.groupsFrozen = d.groupsFrozen;
  return s;
}

/**
 * Put a snapshot back onto `d`. An absent groupsFrozen stays absent (Firestore
 * rejects undefined), and assignments pointing at a teacher or group that no
 * longer exists (e.g. a teacher deleted since) are dropped.
 */
function applySnap(d, s) {
  const { groupsFrozen, ...rest } = d;
  const merged = { ...rest, ...s };
  const teacherIds = new Set((merged.teachers || []).map((t) => t.id));
  const groupIds = new Set((merged.groups || []).map((g) => g.id));
  return {
    ...merged,
    assignments: (merged.assignments || []).filter(
      (a) => teacherIds.has(a.teacherId) && groupIds.has(a.groupId),
    ),
  };
}

function createHistory(max = DEFAULT_MAX) {
  const undoStack = [];
  const redoStack = [];
  return {
    /** Remember `data` so the next change can be undone. */
    record(data) {
      undoStack.push(snap(data));
      if (undoStack.length > max) undoStack.shift();
      redoStack.length = 0;
    },
    /** @returns the data with the previous board state restored, or null if there is nothing to undo */
    undo(data) {
      const s = undoStack.pop();
      if (!s) return null;
      redoStack.push(snap(data));
      return applySnap(data, s);
    },
    redo(data) {
      const s = redoStack.pop();
      if (!s) return null;
      undoStack.push(snap(data));
      return applySnap(data, s);
    },
    reset() {
      undoStack.length = 0;
      redoStack.length = 0;
    },
  };
}

export { createHistory };
