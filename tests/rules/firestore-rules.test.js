import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, collection, addDoc } from "firebase/firestore";

const ALLOWED_EMAILS = ["hod@example.com", "cohod@example.com"];

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-my-deployment-buddy",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8081,
    },
  });
});

test.after(async () => {
  await testEnv.cleanup();
});

test("an allowed email can read and write deployments/main", async () => {
  const ctx = testEnv.authenticatedContext("hod-uid", {
    email: ALLOWED_EMAILS[0],
  });
  const db = ctx.firestore();
  await assertSucceeds(setDoc(doc(db, "deployments/main"), { roles: [] }));
  await assertSucceeds(getDoc(doc(db, "deployments/main")));
});

test("an allowed email can read and write a version in the versions subcollection", async () => {
  const ctx = testEnv.authenticatedContext("hod-uid", {
    email: ALLOWED_EMAILS[0],
  });
  const db = ctx.firestore();
  await assertSucceeds(
    addDoc(collection(db, "deployments/main/versions"), {
      name: "v1",
      timestamp: new Date().toISOString(),
      assignments: [],
      layerSettings: [],
    }),
  );
});

test("an email not on the allowlist is denied", async () => {
  const ctx = testEnv.authenticatedContext("stranger-uid", {
    email: "stranger@example.com",
  });
  const db = ctx.firestore();
  await assertFails(setDoc(doc(db, "deployments/main"), { roles: [] }));
  await assertFails(getDoc(doc(db, "deployments/main")));
});

test("an unauthenticated request is denied", async () => {
  const ctx = testEnv.unauthenticatedContext();
  const db = ctx.firestore();
  await assertFails(getDoc(doc(db, "deployments/main")));
});
