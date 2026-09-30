// Tiny DOM helpers shared by every ui/*.js tab module. No framework - plain
// string templates rendered via innerHTML, so every interpolated value -
// text AND attribute values - must be routed through esc() (see the
// attribute-injection lesson: a data-* attribute left unescaped is just as
// exploitable as an innerHTML text node when the page's CSP allows inline
// event handlers/styles).

/** Escapes a value for safe interpolation into HTML text OR an attribute. */
function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch],
  );
}

function genId(prefix) {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}

/**
 * Every tab re-renders by replacing a container's innerHTML wholesale on
 * every setData() (see store.js/registry - every tab fires setData() per
 * keystroke, and onChange(renderAll) re-renders every tab on every call).
 * innerHTML replacement destroys and recreates every descendant node,
 * including whichever input the HOD is actively typing into - without this,
 * the input loses focus after every single character, forcing a re-click
 * to type the next one. Path-based re-find works because render functions
 * identify repeated elements only via data-* attributes, and the DOM shape
 * is identical before/after a same-data-shape re-render.
 */
function withFocusPreserved(container, renderFn) {
  const active = document.activeElement;
  let restore = null;

  if (active && container.contains(active) && active !== container) {
    const parts = [];
    for (let el = active; el && el !== container; el = el.parentElement) {
      const dataAttrs = [...el.attributes]
        .filter((a) => a.name.startsWith("data-"))
        .map((a) => `[${a.name}="${CSS.escape(a.value)}"]`)
        .join("");
      parts.unshift(el.tagName.toLowerCase() + dataAttrs);
    }
    const selector = parts.join(" > ");
    const selectionStart =
      typeof active.selectionStart === "number" ? active.selectionStart : null;
    const selectionEnd =
      typeof active.selectionEnd === "number" ? active.selectionEnd : null;

    const wasNumber = active.type === "number";

    restore = () => {
      const found = container.querySelector(selector);
      if (!found) return;
      found.focus();
      if (wasNumber) {
        // A number box reports no selection and refuses setSelectionRange,
        // so after the re-render its caret lands at the START - typing "47"
        // would then produce "74". Briefly treat it as text to park the
        // caret at the end, where typing and Backspace both expect it.
        try {
          found.type = "text";
          const end = found.value.length;
          found.setSelectionRange(end, end);
        } finally {
          found.type = "number";
        }
        return;
      }
      if (selectionStart === null) return;
      try {
        found.setSelectionRange(selectionStart, selectionEnd);
      } catch {
        // Some input types (e.g. number) don't support setSelectionRange -
        // focus alone is still a win over losing it entirely.
      }
    };
  }

  renderFn();
  if (restore) restore();
}

/**
 * True while the user has emptied a number box mid-edit (also true for
 * half-typed input like "-", which a number box reports as ""). Input
 * handlers must NOT coerce that to 0/1 and write it back: the re-render
 * would put the coerced value straight back into the box, so the last digit
 * could never be deleted. Ignore the event instead; the last valid value
 * stays in the data until a real number is typed.
 */
function isBlankNumberInput(el) {
  return el.type === "number" && el.value === "";
}

/**
 * If the user leaves a required number box empty, put back the last valid
 * value (the value the box was rendered with - every valid keystroke
 * re-renders, so that is always the latest saved value) instead of leaving
 * an empty box that disagrees with the saved data. Boxes where empty is a
 * real answer opt out with data-blank-ok.
 */
function installBlankNumberRestore() {
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (!isBlankNumberInput(el) || "blankOk" in el.dataset) return;
    if (!el.dataset.field && el.dataset.action !== "weight-layer") return;
    el.value = el.defaultValue;
  });
}

export {
  esc,
  genId,
  withFocusPreserved,
  isBlankNumberInput,
  installBlankNumberRestore,
};
