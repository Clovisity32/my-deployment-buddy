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

export { esc, genId };
