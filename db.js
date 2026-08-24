/*
 * db.js — tiny IndexedDB wrapper.
 * Stores whole "project" objects (including photo Blobs nested inside
 * entries) in a single object store. No external dependency: modern
 * browsers can store Blob values directly inside structured-clone objects,
 * so we don't need a separate photo table.
 */
const DB = (() => {
  const DB_NAME = "pdp-protokolle";
  const DB_VERSION = 2;
  const STORE = "projects";
  const SETTINGS_STORE = "settings";
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(mode) {
    const db = await open();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  async function settingsTx(mode) {
    const db = await open();
    return db.transaction(SETTINGS_STORE, mode).objectStore(SETTINGS_STORE);
  }

  return {
    async saveProject(project) {
      const store = await tx("readwrite");
      return new Promise((resolve, reject) => {
        const req = store.put(project);
        req.onsuccess = () => resolve(project);
        req.onerror = () => reject(req.error);
      });
    },

    async getProject(id) {
      const store = await tx("readonly");
      return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    },

    async getAllProjects() {
      const store = await tx("readonly");
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },

    async deleteProject(id) {
      const store = await tx("readwrite");
      return new Promise((resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },

    /** Company profile (logo + name) used on every export. One record, id "company". */
    async getSettings() {
      const store = await settingsTx("readonly");
      return new Promise((resolve, reject) => {
        const req = store.get("company");
        req.onsuccess = () => resolve(req.result || { id: "company", companyName: "", logoDataUrl: "" });
        req.onerror = () => reject(req.error);
      });
    },

    async saveSettings(settings) {
      const store = await settingsTx("readwrite");
      const record = Object.assign({ id: "company" }, settings);
      return new Promise((resolve, reject) => {
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
      });
    }
  };
})();
