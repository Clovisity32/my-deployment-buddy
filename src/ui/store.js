// Single source of truth for the browser UI's in-memory `data`, shared by
// every ui/*.js tab module (they used to reach into ui.js's module-level
// `data`/`dirty`/`setData` closures directly; now they import from here).

import { loadFromStorage, saveToStorage } from "../data.js";

let data = loadFromStorage();
let dirty = false; // true once data has changed since the last "Save to Excel".
const listeners = [];

/** @returns {any} the current data object. Never mutate the returned value directly - always go through setData(). */
function getData() {
  return data;
}

/**
 * Replace `data`, mark the app dirty, persist to localStorage (best-effort -
 * the Excel file remains the real source of truth), then notify every
 * registered listener (ui.js registers a single `renderAll` that fans out
 * to every tab module's own render function).
 * @param {any} next
 */
function setData(next) {
  data = next;
  dirty = true;
  saveToStorage(data);
  listeners.forEach((fn) => fn());
}

/**
 * Init-only escape hatch: replaces `data` without marking dirty, saving, or
 * notifying listeners. Only safe to call before any listener is registered
 * (i.e. during boot, before ui.js's init() calls onChange(renderAll)).
 * @param {any} next
 */
function replaceData(next) {
  data = next;
}

/** @param {() => void} fn called after every setData(). */
function onChange(fn) {
  listeners.push(fn);
}

function isDirty() {
  return dirty;
}

function clearDirty() {
  dirty = false;
}

export { getData, setData, replaceData, onChange, isDirty, clearDirty };
