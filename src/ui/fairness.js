// Fairness emphasis card (Solve tab): preset buttons and four 1-5 sliders. The
// markup is static in index.html, so this only sets values and listens; a
// slider mid-drag is never replaced by a re-render. Slider changes use the
// `change` event (fires on release), presets use click.

import { getData, setData } from "./store.js";
import { FAIRNESS_PRESETS, fairnessSettings } from "../data.js";

const LABELS = {
  classCountFirst: "Class count first",
  balanced: "Balanced",
  fewerPreps: "Fewer preps",
  custom: "Custom",
};

function renderFairness() {
  const root = document.getElementById("fairness");
  if (!root) return;
  const { preset, levels } = fairnessSettings(getData());
  for (const b of root.querySelectorAll('[data-action="fairness-preset"]')) {
    b.setAttribute(
      "aria-pressed",
      b.dataset.preset === preset ? "true" : "false",
    );
  }
  for (const input of root.querySelectorAll('[data-action="fairness-level"]')) {
    input.value = String(levels[input.dataset.key]);
    const out = root.querySelector(`[data-role="level-${input.dataset.key}"]`);
    if (out) out.textContent = `step ${levels[input.dataset.key]} of 5`;
  }
  const status = root.querySelector('[data-role="fairness-status"]');
  if (status && !status.dataset.touched)
    status.textContent = `Current emphasis: ${LABELS[preset]}.`;
}

function save(root, preset, levels, message) {
  const data = getData();
  setData({
    ...data,
    settings: { ...(data.settings || {}), fairness: { preset, levels } },
  });
  const status = root.querySelector('[data-role="fairness-status"]');
  if (status) {
    status.dataset.touched = "1";
    status.textContent = message;
  }
}

function wireFairness() {
  const root = document.getElementById("fairness");
  if (!root) return;
  root.addEventListener("click", (e) => {
    const b = e.target.closest('[data-action="fairness-preset"]');
    if (!b || !FAIRNESS_PRESETS[b.dataset.preset]) return;
    save(
      root,
      b.dataset.preset,
      { ...FAIRNESS_PRESETS[b.dataset.preset] },
      `Fairness emphasis set to ${LABELS[b.dataset.preset]}. It applies the next time you press Solve.`,
    );
  });
  root.addEventListener("change", (e) => {
    const input = e.target.closest('[data-action="fairness-level"]');
    if (!input) return;
    const { levels } = fairnessSettings(getData());
    const next = { ...levels, [input.dataset.key]: Number(input.value) };
    save(
      root,
      "custom",
      next,
      "Fairness emphasis set to Custom. It applies the next time you press Solve.",
    );
  });
}

export { renderFairness, wireFairness };
