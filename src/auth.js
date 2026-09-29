import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  connectAuthEmulator,
} from "firebase/auth";
import { firebaseConfig, useEmulators } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
}

let currentUser = null;
const listeners = [];

onAuthStateChanged(auth, (user) => {
  currentUser = user ? { email: user.email, uid: user.uid } : null;
  listeners.forEach((fn) => fn(currentUser));
});

/** @param {(user: {email:string, uid:string} | null) => void} fn */
function onAuthChange(fn) {
  listeners.push(fn);
  fn(currentUser); // Call immediately with current state
}

function getCurrentUser() {
  return currentUser;
}

async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

async function signOutUser() {
  await signOut(auth);
}

export { app, onAuthChange, getCurrentUser, signInWithGoogle, signOutUser };
