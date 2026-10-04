// "Rebuild groups from setup": the only way to replace the Board's groups
// with ones regenerated from Subjects/Classes/Bands. Always asks first.

import { getData, setData } from "./store.js";
import { esc } from "./dom.js";
import { rebuildFromSetup } from "../board.js";
import { resetHistory } from "./board.js";

const BUTTONS = [
  ["btn-rebuild-groups-classes", "classes-status"],
  ["btn-rebuild-groups-bands", "bands-status"],
];

function wireRebuildButtons() {
  for (const [buttonId, statusId] of BUTTONS) {
    const button = document.getElementById(buttonId);
    if (!button) continue;
    button.addEventListener("click", () => {
      const data = getData();
      const { data: rebuilt, droppedCount } = rebuildFromSetup(data);
      const message =
        `Rebuild groups from setup?\n\nThis replaces the ${(data.groups || []).length} group(s) on the Board with ${rebuilt.groups.length} generated from Subjects, Classes and Bands. ` +
        `${droppedCount} teacher assignment(s) will be removed because their group no longer exists. Your current state is not saved as a version, so press Save version on the Versions tab first if you want to be able to go back.`;
      if (!confirm(message)) return;
      resetHistory();
      setData(rebuilt);
      const box = document.getElementById(statusId);
      if (box) {
        box.innerHTML = `<div class="status ok">Groups rebuilt from setup. ${esc(droppedCount)} assignment(s) were removed.</div>`;
      }
    });
  }
}

export { wireRebuildButtons };
