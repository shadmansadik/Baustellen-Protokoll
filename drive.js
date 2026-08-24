/*
 * drive.js — Google Drive sync using Google Identity Services (GIS) for
 * sign-in and plain fetch() calls to the Drive v3 REST API. Uses the
 * narrow "drive.file" scope: the app can only see/edit files it created
 * itself, never the rest of the user's Drive.
 */
const Drive = (() => {
  let accessToken = null;
  let tokenClient = null;
  let tokenExpiry = 0;
  let rootFolderId = null;

  function isConfigured() {
    return !!(window.PDP_CONFIG && window.PDP_CONFIG.GOOGLE_CLIENT_ID);
  }

  function isSignedIn() {
    return !!accessToken && Date.now() < tokenExpiry;
  }

  function ensureTokenClient() {
    if (tokenClient) return tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: window.PDP_CONFIG.GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: () => {} // overridden per-call in signIn()
    });
    return tokenClient;
  }

  function signIn() {
    return new Promise((resolve, reject) => {
      if (!isConfigured()) {
        reject(new Error("Google Client ID fehlt in config.js"));
        return;
      }
      if (typeof google === "undefined") {
        reject(new Error("Google-Anmeldebibliothek noch nicht geladen. Bitte kurz warten und erneut versuchen."));
        return;
      }
      const client = ensureTokenClient();
      client.callback = (resp) => {
        if (resp.error) {
          reject(new Error(resp.error));
          return;
        }
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
        resolve(accessToken);
      };
      client.requestAccessToken({ prompt: isSignedIn() ? "" : "consent" });
    });
  }

  function signOut() {
    if (accessToken && typeof google !== "undefined") {
      google.accounts.oauth2.revoke(accessToken, () => {});
    }
    accessToken = null;
    tokenExpiry = 0;
    rootFolderId = null;
  }

  async function authFetch(url, options = {}) {
    if (!isSignedIn()) await signIn();
    const headers = Object.assign({}, options.headers, {
      Authorization: `Bearer ${accessToken}`
    });
    const res = await fetch(url, Object.assign({}, options, { headers }));
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Drive-API-Fehler ${res.status}: ${text.slice(0, 200)}`);
    }
    return res;
  }

  async function findFolder(name, parentId) {
    const q = encodeURIComponent(
      `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false` +
      (parentId ? ` and '${parentId}' in parents` : " and 'root' in parents")
    );
    const res = await authFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
    const data = await res.json();
    return data.files && data.files[0] ? data.files[0].id : null;
  }

  async function createFolder(name, parentId) {
    const metadata = {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined
    };
    const res = await authFetch("https://www.googleapis.com/drive/v3/files?fields=id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata)
    });
    const data = await res.json();
    return data.id;
  }

  async function findOrCreateFolder(name, parentId) {
    const existing = await findFolder(name, parentId);
    if (existing) return existing;
    return createFolder(name, parentId);
  }

  async function ensureRootFolder() {
    if (rootFolderId) return rootFolderId;
    const name = (window.PDP_CONFIG && window.PDP_CONFIG.DRIVE_ROOT_FOLDER_NAME) || "Baustellen-Protokolle";
    rootFolderId = await findOrCreateFolder(name);
    return rootFolderId;
  }

  async function ensureProjectFolder(project) {
    if (project.driveFolderId) return project.driveFolderId;
    const root = await ensureRootFolder();
    const folderName = `${project.title} - ${project.id.slice(-6)}`;
    const id = await findOrCreateFolder(folderName, root);
    project.driveFolderId = id;
    return id;
  }

  function multipartBody(metadata, blob) {
    const boundary = "pdpapp" + Date.now();
    return blob.arrayBuffer().then((buf) => {
      const encoder = new TextEncoder();
      const closeDelim = encoder.encode(`\r\n--${boundary}--`);
      const head = encoder.encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}` +
        `\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType || blob.type}\r\n\r\n`
      );
      const body = new Blob([head, buf, closeDelim]);
      return { body, boundary };
    });
  }

  async function uploadOrUpdate(blob, filename, mimeType, parentId, existingFileId) {
    const metadata = { name: filename, mimeType };
    if (!existingFileId) metadata.parents = [parentId];
    const { body, boundary } = await multipartBody(metadata, blob);
    const url = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`;
    const res = await authFetch(url, {
      method: existingFileId ? "PATCH" : "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body
    });
    const data = await res.json();
    return data.id;
  }

  async function downloadBlob(fileId) {
    const res = await authFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    return res.blob();
  }

  async function listProjectFolders() {
    const root = await ensureRootFolder();
    const q = encodeURIComponent(`'${root}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const res = await authFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&orderBy=name`);
    const data = await res.json();
    return data.files || [];
  }

  async function findJsonInFolder(folderId) {
    const q = encodeURIComponent(`'${folderId}' in parents and name='project.json' and trashed=false`);
    const res = await authFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
    const data = await res.json();
    return data.files && data.files[0] ? data.files[0].id : null;
  }

  /**
   * Uploads any not-yet-synced photo blobs, then writes project.json.
   * Mutates `project` in place with the Drive IDs it learns.
   */
  async function saveProject(project, onStatus) {
    onStatus && onStatus("Verbinde mit Drive …");
    const folderId = await ensureProjectFolder(project);

    const allPhotoGroups = [];
    project.entries.forEach((e) => {
      allPhotoGroups.push(e.photos || []);
      if (e.fix) allPhotoGroups.push(e.fix.photos || []);
    });

    let uploaded = 0;
    const totalPhotos = allPhotoGroups.reduce((n, g) => n + g.filter(p => p.blob && !p.driveFileId).length, 0);

    for (const group of allPhotoGroups) {
      for (const photo of group) {
        if (photo.blob && !photo.driveFileId) {
          uploaded++;
          onStatus && onStatus(`Foto ${uploaded}/${totalPhotos || uploaded} wird hochgeladen …`);
          photo.driveFileId = await uploadOrUpdate(photo.blob, photo.id + ".jpg", "image/jpeg", folderId);
        }
      }
    }

    onStatus && onStatus("Projektdaten werden gespeichert …");
    const serializable = ProjectModel.toSerializable(project);
    const jsonBlob = new Blob([JSON.stringify(serializable)], { type: "application/json" });
    project.driveJsonId = await uploadOrUpdate(jsonBlob, "project.json", "application/json", folderId, project.driveJsonId);

    onStatus && onStatus("Fertig gespeichert.");
    return project;
  }

  async function loadProjectList() {
    const folders = await listProjectFolders();
    const results = [];
    for (const f of folders) {
      const jsonId = await findJsonInFolder(f.id);
      if (!jsonId) continue;
      const blob = await downloadBlob(jsonId);
      const text = await blob.text();
      try {
        const data = JSON.parse(text);
        data.driveFolderId = f.id;
        data.driveJsonId = jsonId;
        results.push(data);
      } catch (e) { /* skip corrupt file */ }
    }
    return results;
  }

  /** Downloads photo blobs for a project fetched from Drive so it can be edited/exported. */
  async function hydratePhotos(project, onStatus) {
    const groups = [];
    project.entries.forEach((e) => {
      groups.push(e.photos || []);
      if (e.fix) groups.push(e.fix.photos || []);
    });
    let done = 0;
    const total = groups.reduce((n, g) => n + g.filter(p => p.driveFileId && !p.blob).length, 0);
    for (const group of groups) {
      for (const photo of group) {
        if (photo.driveFileId && !photo.blob) {
          done++;
          onStatus && onStatus(`Foto ${done}/${total || done} wird geladen …`);
          photo.blob = await downloadBlob(photo.driveFileId);
        }
      }
    }
    return project;
  }

  return {
    isConfigured, isSignedIn, signIn, signOut,
    saveProject, loadProjectList, hydratePhotos
  };
})();
