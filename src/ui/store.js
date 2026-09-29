// Single source of truth for the browser UI's in-memory `data`, backed by
// Firestore (deployments/main). Every tab module (src/ui/*.js) still only
// ever calls getData()/setData()/onChange() - only this file's internals
// know about Firestore. See
// docs/superpowers/specs/2026-09-29-firestore-sync-design.md "Conflict /
// overwrite guard" for why setData() is optimistic-local + transactional.

import {
  getFirestore,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  connectFirestoreEmulator,
} from "firebase/firestore";
import { app, getCurrentUser } from "../auth.js";
import { useEmulators } from "../firebase-config.js";

const db = getFirestore(app);
if (useEmulators) {
  connectFirestoreEmulator(db, "127.0.0.1", 8081);
}

function mainDocRef() {
  return doc(db, "deployments", "main");
}

function emptyDeploymentDoc() {
  return {
    roles: [],
    subjects: [],
    classes: [],
    bands: [],
    teachers: [],
    groups: [],
    groupOverrides: {},
    customGroups: [],
    assignments: [],
    layerSettings: [],
  };
}

let data = null;
let loadedUpdatedAt = null;
let blocked = false;
const listeners = [];
const statusListeners = [];

function getData() {
  return data;
}

function onChange(fn) {
  listeners.push(fn);
}

function onSaveStatusChange(fn) {
  statusListeners.push(fn);
}

function isBlocked() {
  return blocked;
}

function getFirestoreDb() {
  return db;
}

function notifyStatus(status, message) {
  statusListeners.forEach((fn) => fn({ status, message }));
}

/** Fetches deployments/main once. Call after sign-in, before rendering. */
async function initStore() {
  const snap = await getDoc(mainDocRef());
  const fetched = snap.exists() ? snap.data() : emptyDeploymentDoc();
  loadedUpdatedAt = fetched.updatedAt || null;
  const { updatedAt, updatedBy, ...rest } = fetched;
  data = rest;
}

class ConflictError extends Error {
  constructor(updatedBy) {
    super("conflict");
    this.updatedBy = updatedBy;
  }
}

function stripMeta({ updatedAt, updatedBy, ...rest }) {
  return rest;
}

async function writeToFirestore(next) {
  const ref = mainDocRef();
  const user = getCurrentUser();
  notifyStatus("saving");
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const serverUpdatedAt = snap.exists() ? snap.data().updatedAt : null;
      const bothPresent = loadedUpdatedAt && serverUpdatedAt;
      const changed =
        bothPresent &&
        !(serverUpdatedAt.isEqual
          ? serverUpdatedAt.isEqual(loadedUpdatedAt)
          : serverUpdatedAt === loadedUpdatedAt);
      if (changed) {
        throw new ConflictError(snap.data().updatedBy);
      }
      tx.set(ref, {
        ...stripMeta(next),
        updatedAt: serverTimestamp(),
        updatedBy: user ? user.email : null,
      });
    });
    const snap = await getDoc(ref);
    loadedUpdatedAt = snap.data().updatedAt;
    notifyStatus("saved");
  } catch (err) {
    if (err instanceof ConflictError) {
      blocked = true;
      const snap = await getDoc(ref);
      const { updatedAt, updatedBy, ...rest } = snap.data();
      data = rest;
      listeners.forEach((fn) => fn());
      notifyStatus(
        "conflict",
        `${err.updatedBy || "Someone else"} updated this since you opened it - reload to see their changes before continuing.`,
      );
    } else {
      notifyStatus("error", err.message);
    }
  }
}

/**
 * Updates the in-memory cache and notifies listeners immediately (instant
 * UI feedback, same feel as the old localStorage-backed store), then writes
 * to Firestore in the background. A no-op once isBlocked() is true.
 */
function setData(next) {
  if (blocked) {
    notifyStatus("blocked", "Reload the page to continue.");
    return;
  }
  data = next;
  listeners.forEach((fn) => fn());
  writeToFirestore(next);
}

export {
  initStore,
  getData,
  setData,
  onChange,
  onSaveStatusChange,
  isBlocked,
  getFirestoreDb,
};
