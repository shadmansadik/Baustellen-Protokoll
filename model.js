/*
 * model.js — shape of the data used throughout the app, plus helpers to
 * convert between the "live" in-memory form (with Blob photos) and the
 * JSON-serializable form saved to Drive (Blobs replaced by Drive file
 * IDs; the actual bytes travel as separate uploaded files).
 */
const ProjectModel = (() => {

  function newId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function createProject({ type, title, termin, teilnehmer, linkedProjectId }) {
    return {
      id: newId("proj"),
      type,               // "abnahme" | "maengel" | "custom"
      title,
      termin: termin || "",
      teilnehmer: teilnehmer || [],
      linkedProjectId: linkedProjectId || null,
      deadline: "",        // "Frist zur Mängelbeseitigung" — optional, set later
      signedBy: "",         // "Gez." — optional, set later
      signedDate: "",
      entries: [],
      driveFolderId: null,
      driveJsonId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function createEntry({ title, description }) {
    return {
      id: newId("entry"),
      title: title || "",
      description: description || "",
      status: "open",      // "open" | "done" — simple progress tracking
      photos: [],
      fix: null // { description, photos: [] } once a Mängelbeseitigung is added
    };
  }

  function ensureFix(entry) {
    if (!entry.fix) {
      entry.fix = { description: "", photos: [] };
    }
    return entry.fix;
  }

  /** Deep-clone a project into a Drive-safe JSON object (no Blobs). */
  function toSerializable(project) {
    const clone = JSON.parse(JSON.stringify(project, (key, value) => {
      if (key === "blob") return undefined; // never serialize raw bytes
      return value;
    }));
    return clone;
  }

  /** Swaps entry at `index` with its neighbour ("up" or "down"). No-op at the edges. */
  function moveEntry(project, index, direction) {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= project.entries.length) return false;
    const arr = project.entries;
    [arr[index], arr[target]] = [arr[target], arr[index]];
    return true;
  }

  /** Photo metadata without the blob, e.g. for quick list rendering. */
  function photoLabel(photo) {
    const parts = [];
    if (photo.address) parts.push(photo.address);
    if (photo.timestamp) {
      const d = new Date(photo.timestamp);
      parts.push(d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }));
    }
    return parts.join(" · ");
  }

  return { newId, createProject, createEntry, ensureFix, moveEntry, toSerializable, photoLabel };
})();
