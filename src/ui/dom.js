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

    restore = () => {
      const found = container.querySelector(selector);
      if (!found) return;
      found.focus();
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

export { esc, genId, withFocusPreserved };
