/*
 * config.js — the only file you should need to edit to connect this
 * app to YOUR Google account for Drive sync.
 *
 * How to get these two values: see README.md, section
 * "Google Drive einrichten (einmalig)".
 *
 * If you leave CLIENT_ID empty, the app still works fully offline —
 * projects are simply kept on the device (IndexedDB) and you export
 * PDF/Word manually.
 */
window.PDP_CONFIG = {
  GOOGLE_CLIENT_ID: "", // e.g. "1234567890-abc123.apps.googleusercontent.com"
  DRIVE_ROOT_FOLDER_NAME: "Baustellen-Protokolle"
};
