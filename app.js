/*
 * app.js — screens, routing and event wiring. No framework: templates
 * are cloned into #app and wired up by hand. Keep this file readable
 * over clever — it's the file you'll edit most when adding features.
 */

const appEl = document.getElementById("app");
const headerTitle = document.getElementById("headerTitle");
const btnBack = document.getElementById("btnBack");
const btnAccount = document.getElementById("btnAccount");
const btnSettings = document.getElementById("btnSettings");
const toastEl = document.getElementById("toast");

let backStack = [];
let currentScreen = null;

function showToast(msg, ms = 2600) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.hidden = true; }, ms);
}

function navigate(name, params = {}, opts = {}) {
  if (currentScreen && !opts.replace) backStack.push(currentScreen);
  currentScreen = { name, params };
  render(name, params);
}

function goBack() {
  const prev = backStack.pop();
  if (prev) {
    currentScreen = prev;
    render(prev.name, prev.params);
  } else {
    navigate("home", {}, { replace: true });
  }
}

btnBack.addEventListener("click", goBack);
btnSettings.addEventListener("click", () => navigate("settings"));

function setHeader(title, showBack) {
  headerTitle.textContent = title;
  btnBack.hidden = !showBack;
}

function render(name, params) {
  appEl.innerHTML = "";
  if (name === "home") return renderHome();
  if (name === "new-project") return renderNewProject();
  if (name === "project") return renderProject(params.id);
  if (name === "entry") return renderEntry(params.projectId, params.entryId);
  if (name === "edit-project") return renderEditProject(params.id);
  if (name === "settings") return renderSettings();
}

// ============================================================ HOME

async function renderHome() {
  setHeader("Baustellen-Protokoll", false);
  const tpl = document.getElementById("tpl-home");
  appEl.appendChild(tpl.content.cloneNode(true));

  const statusBox = document.getElementById("driveStatus");
  const statusText = document.getElementById("driveStatusText");
  const btnConnect = document.getElementById("btnConnectDrive");

  function refreshDriveStatus() {
    if (!Drive.isConfigured()) {
      statusText.textContent = "Drive-Sync nicht eingerichtet (siehe README)";
      btnConnect.textContent = "—";
      btnConnect.disabled = true;
    } else if (Drive.isSignedIn()) {
      statusBox.classList.add("connected");
      statusText.textContent = "Mit Google Drive verbunden";
      btnConnect.textContent = "Aktualisieren";
      btnConnect.disabled = false;
    } else {
      statusBox.classList.remove("connected");
      statusText.textContent = "Nicht mit Google Drive verbunden";
      btnConnect.textContent = "Verbinden";
      btnConnect.disabled = false;
    }
  }
  refreshDriveStatus();

  btnConnect.addEventListener("click", async () => {
    try {
      await Drive.signIn();
      showToast("Verbunden. Projekte werden abgeglichen …");
      await syncFromDrive();
      refreshDriveStatus();
      await loadAndRenderProjects();
    } catch (e) {
      showToast(e.message || "Verbindung fehlgeschlagen");
    }
  });

  document.getElementById("btnNewProject").addEventListener("click", () => {
    navigate("new-project");
  });

  await loadAndRenderProjects();
}

async function syncFromDrive() {
  if (!Drive.isSignedIn()) return;
  try {
    const remoteProjects = await Drive.loadProjectList();
    const local = await DB.getAllProjects();
    const localIds = new Set(local.map(p => p.id));
    for (const rp of remoteProjects) {
      if (!localIds.has(rp.id)) {
        await DB.saveProject(rp);
      }
    }
  } catch (e) {
    console.warn("Drive-Sync fehlgeschlagen:", e);
  }
}

async function loadAndRenderProjects() {
  const list = document.getElementById("projectList");
  const empty = document.getElementById("emptyState");
  const projects = await DB.getAllProjects();
  projects.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  list.innerHTML = "";
  empty.hidden = projects.length > 0;

  const typeLabels = { abnahme: "Abnahme", maengel: "Mängelbeseitigung", custom: "Eigenes" };

  for (const p of projects) {
    const card = document.createElement("div");
    card.className = "project-card";
    const photoCount = p.entries.reduce((n, e) => n + (e.photos ? e.photos.length : 0) + (e.fix ? e.fix.photos.length : 0), 0);
    card.innerHTML = `
      <div class="p-title">${escapeHtml(p.title)}</div>
      <div class="p-sub">
        <span class="badge type-${p.type}">${typeLabels[p.type] || p.type}</span>
        <span>${p.entries.length} Orte · ${photoCount} Fotos</span>
        ${p.driveFolderId ? '<span class="badge synced">In Drive</span>' : ""}
      </div>
    `;
    card.addEventListener("click", () => navigate("project", { id: p.id }));
    list.appendChild(card);
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

// ======================================================= NEW PROJECT

async function renderNewProject() {
  setHeader("Neues Projekt", true);
  const tpl = document.getElementById("tpl-new-project");
  appEl.appendChild(tpl.content.cloneNode(true));

  const typeSelect = document.getElementById("projType");
  const linkWrap = document.getElementById("linkProjectWrap");
  const linkSelect = document.getElementById("linkedProjectSelect");

  const allProjects = await DB.getAllProjects();
  const abnahmeProjects = allProjects.filter(p => p.type === "abnahme");

  function refreshLinkVisibility() {
    linkWrap.hidden = typeSelect.value !== "maengel";
  }
  typeSelect.addEventListener("change", refreshLinkVisibility);
  refreshLinkVisibility();

  linkSelect.innerHTML = '<option value="">— keins —</option>' +
    abnahmeProjects.map(p => `<option value="${p.id}">${escapeHtml(p.title)}</option>`).join("");

  document.getElementById("formNewProject").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const type = fd.get("type");
    const title = fd.get("title").trim();
    const termin = fd.get("termin");
    const teilnehmer = fd.get("teilnehmer").split("\n").map(s => s.trim()).filter(Boolean);
    const linkedProjectId = type === "maengel" ? (fd.get("linkedProjectId") || null) : null;

    const project = ProjectModel.createProject({ type, title, termin, teilnehmer, linkedProjectId });

    if (linkedProjectId) {
      const source = allProjects.find(p => p.id === linkedProjectId);
      if (source) {
        project.entries = source.entries.map(se => {
          const e = ProjectModel.createEntry({ title: se.title, description: se.description });
          e.fix = { description: "", photos: [] };
          return e;
        });
      }
    }

    await DB.saveProject(project);
    showToast("Projekt erstellt");
    navigate("project", { id: project.id }, { replace: true });
  });
}

// =========================================================== PROJECT

async function renderProject(id) {
  const project = await DB.getProject(id);
  if (!project) { navigate("home", {}, { replace: true }); return; }

  setHeader(project.title, true);
  const tpl = document.getElementById("tpl-project");
  appEl.appendChild(tpl.content.cloneNode(true));

  const typeLabels = { abnahme: "Abnahmeprotokoll", maengel: "Mängelbeseitigung", custom: "Eigenes Protokoll" };
  const metaBox = document.getElementById("projectMetaBox");
  const editBtn = document.getElementById("btnEditProject");
  metaBox.insertAdjacentHTML("beforeend", `
    <h2>${escapeHtml(project.title)}</h2>
    <div class="meta-row"><span class="badge type-${project.type}">${typeLabels[project.type]}</span></div>
    ${project.termin ? `<div class="meta-row">Termin: ${new Date(project.termin).toLocaleString("de-DE")}</div>` : ""}
    ${project.teilnehmer.length ? `<div class="meta-row">Teilnehmer: ${escapeHtml(project.teilnehmer.join(", "))}</div>` : ""}
    ${project.deadline ? `<div class="meta-row">Frist zur Mängelbeseitigung: ${new Date(project.deadline).toLocaleDateString("de-DE")}</div>` : ""}
    ${project.signedBy ? `<div class="meta-row">Gez.: ${escapeHtml(project.signedBy)}${project.signedDate ? ", " + new Date(project.signedDate).toLocaleDateString("de-DE") : ""}</div>` : ""}
  `);
  editBtn.addEventListener("click", () => navigate("edit-project", { id: project.id }));

  const progressBox = document.getElementById("progressBox");
  function renderProgress() {
    const showProgress = project.type !== "abnahme" && project.entries.length > 0;
    progressBox.hidden = !showProgress;
    if (!showProgress) return;
    const done = project.entries.filter(e => e.status === "done").length;
    const total = project.entries.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    progressBox.innerHTML = `
      <span class="progress-label">${done}/${total} behoben</span>
      <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    `;
  }

  const entryList = document.getElementById("entryList");
  const emptyState = document.getElementById("entryEmptyState");

  function renderEntries() {
    entryList.innerHTML = "";
    emptyState.hidden = project.entries.length > 0;
    project.entries.forEach((entry, idx) => {
      const card = document.createElement("div");
      card.className = "entry-card";
      const firstPhoto = (entry.photos && entry.photos[0]) || null;
      const thumbSrc = firstPhoto ? (firstPhoto.blob ? URL.createObjectURL(firstPhoto.blob) : "") : "";
      const fixCount = entry.fix ? entry.fix.photos.length : 0;
      const showStatus = project.type !== "abnahme";
      card.innerHTML = `
        ${thumbSrc ? `<img class="entry-thumb" src="${thumbSrc}">` : `<div class="entry-thumb"></div>`}
        <div class="entry-info">
          <div class="e-title">${showStatus ? `<span class="status-dot ${entry.status === "done" ? "done" : ""}"></span>` : ""}${escapeHtml(entry.title || "(ohne Titel)")}</div>
          <div class="e-sub">${escapeHtml(entry.description || "")}</div>
          <div class="e-counts">${entry.photos.length} Foto(s)${entry.fix ? ` · ${fixCount} Behebungsfoto(s)` : ""}</div>
        </div>
        <div class="entry-reorder">
          <button type="button" class="btn-up" ${idx === 0 ? "disabled" : ""} aria-label="Nach oben">▲</button>
          <button type="button" class="btn-down" ${idx === project.entries.length - 1 ? "disabled" : ""} aria-label="Nach unten">▼</button>
        </div>
      `;
      card.querySelector(".entry-info").addEventListener("click", () => navigate("entry", { projectId: project.id, entryId: entry.id }));
      card.querySelector(".entry-thumb").addEventListener("click", () => navigate("entry", { projectId: project.id, entryId: entry.id }));
      card.querySelector(".btn-up").addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (ProjectModel.moveEntry(project, idx, "up")) { await DB.saveProject(project); renderEntries(); }
      });
      card.querySelector(".btn-down").addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (ProjectModel.moveEntry(project, idx, "down")) { await DB.saveProject(project); renderEntries(); }
      });
      entryList.appendChild(card);
    });
    renderProgress();
  }
  renderEntries();

  document.getElementById("btnNewEntry").addEventListener("click", async () => {
    const entry = ProjectModel.createEntry({});
    if (project.type !== "abnahme") entry.fix = { description: "", photos: [] };
    project.entries.push(entry);
    await DB.saveProject(project);
    navigate("entry", { projectId: project.id, entryId: entry.id });
  });

  document.getElementById("btnExportPdf").addEventListener("click", async () => {
    try {
      showToast("PDF wird erstellt …");
      const settings = await DB.getSettings();
      const blob = await Export.buildPdf(project, settings);
      Export.downloadBlob(blob, `${sanitizeFilename(project.title)}.pdf`);
      showToast("PDF heruntergeladen");
    } catch (e) {
      console.error(e);
      showToast("PDF-Export fehlgeschlagen: " + e.message);
    }
  });

  document.getElementById("btnExportDocx").addEventListener("click", async () => {
    try {
      showToast("Word-Dokument wird erstellt …");
      const settings = await DB.getSettings();
      const blob = await Export.buildDocx(project, settings);
      Export.downloadBlob(blob, `${sanitizeFilename(project.title)}.docx`);
      showToast("Word-Dokument heruntergeladen");
    } catch (e) {
      console.error(e);
      showToast("Word-Export fehlgeschlagen: " + e.message);
    }
  });

  document.getElementById("btnSaveDrive").addEventListener("click", async () => {
    if (!Drive.isConfigured()) {
      showToast("Drive ist nicht eingerichtet — siehe README.md");
      return;
    }
    try {
      await Drive.saveProject(project, (msg) => showToast(msg, 4000));
      await DB.saveProject(project);
      showToast("In Drive gespeichert");
      renderEntries();
    } catch (e) {
      console.error(e);
      showToast("Drive-Speichern fehlgeschlagen: " + e.message);
    }
  });

  document.getElementById("btnDeleteProject").addEventListener("click", async () => {
    if (!confirm(`„${project.title}“ wirklich löschen? Das entfernt es nur von diesem Gerät, nicht aus Drive.`)) return;
    await DB.deleteProject(project.id);
    showToast("Projekt gelöscht");
    navigate("home", {}, { replace: true });
  });
}

function sanitizeFilename(s) {
  return (s || "protokoll").replace(/[^a-z0-9äöüß_\- ]/gi, "").trim().replace(/\s+/g, "_") || "protokoll";
}

// ============================================================= ENTRY

async function renderEntry(projectId, entryId) {
  const project = await DB.getProject(projectId);
  if (!project) { navigate("home", {}, { replace: true }); return; }
  const entry = project.entries.find(e => e.id === entryId);
  if (!entry) { navigate("project", { id: projectId }, { replace: true }); return; }

  setHeader(entry.title || "Neuer Ort", true);
  const tpl = document.getElementById("tpl-entry");
  appEl.appendChild(tpl.content.cloneNode(true));

  document.getElementById("entryTitle").value = entry.title || "";
  document.getElementById("entryDescription").value = entry.description || "";

  const statusRow = document.getElementById("statusToggleRow");
  const statusBtn = document.getElementById("btnToggleStatus");
  const showStatus = project.type !== "abnahme";
  statusRow.hidden = !showStatus;
  function renderStatusBtn() {
    const isDone = entry.status === "done";
    statusBtn.textContent = isDone ? "Behoben" : "Offen";
    statusBtn.classList.toggle("is-done", isDone);
  }
  if (showStatus) {
    renderStatusBtn();
    statusBtn.addEventListener("click", async () => {
      entry.status = entry.status === "done" ? "open" : "done";
      renderStatusBtn();
      await DB.saveProject(project);
    });
  }

  const fixSection = document.getElementById("fixSection");
  const showFix = project.type !== "abnahme";
  fixSection.hidden = !showFix;
  if (showFix) {
    ProjectModel.ensureFix(entry);
    document.getElementById("fixDescription").value = entry.fix.description || "";
  }

  const photoGrid = document.getElementById("photoGrid");
  const fixPhotoGrid = document.getElementById("fixPhotoGrid");

  function renderPhotoGrid(grid, photos) {
    grid.innerHTML = "";
    photos.forEach((photo, idx) => {
      const cell = document.createElement("div");
      cell.className = "photo-cell";
      const item = document.createElement("div");
      item.className = "photo-item";
      const src = photo.blob ? URL.createObjectURL(photo.blob) : "";
      item.innerHTML = `
        <img src="${src}" alt="Foto">
        <button type="button" class="photo-remove" aria-label="Foto entfernen">✕</button>
        <div class="photo-meta">${escapeHtml(ProjectModel.photoLabel(photo))}</div>
      `;
      item.querySelector(".photo-remove").addEventListener("click", async () => {
        photos.splice(idx, 1);
        await DB.saveProject(project);
        renderPhotoGrid(grid, photos);
      });
      const captionInput = document.createElement("input");
      captionInput.type = "text";
      captionInput.className = "photo-caption-input";
      captionInput.placeholder = "Beschriftung (optional)";
      captionInput.value = photo.caption || "";
      captionInput.addEventListener("change", async () => {
        photo.caption = captionInput.value.trim();
        await DB.saveProject(project);
      });
      cell.appendChild(item);
      cell.appendChild(captionInput);
      grid.appendChild(cell);
    });
  }
  renderPhotoGrid(photoGrid, entry.photos);
  if (showFix) renderPhotoGrid(fixPhotoGrid, entry.fix.photos);

  function handlePhotoInput(inputEl, targetArray, grid, processorFn) {
    inputEl.addEventListener("change", async () => {
      const files = Array.from(inputEl.files || []);
      inputEl.value = "";
      if (!files.length) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const prefix = files.length > 1 ? `Foto ${i + 1}/${files.length}: ` : "";
        showToast(prefix + "wird verarbeitet …", 8000);
        try {
          const photo = await processorFn(file, (msg) => showToast(prefix + msg, 8000));
          targetArray.push(photo);
          await DB.saveProject(project);
          renderPhotoGrid(grid, targetArray);
          if (!document.getElementById("entryTitle").value && photo.address) {
            document.getElementById("entryTitle").value = photo.address;
          }
        } catch (e) {
          console.error(e);
          showToast("Foto konnte nicht verarbeitet werden: " + e.message);
        }
      }
      showToast(files.length > 1 ? `${files.length} Fotos hinzugefügt` : "Foto hinzugefügt");
    });
  }
  handlePhotoInput(document.getElementById("photoInput"), entry.photos, photoGrid, Camera.processCapturedPhoto);
  handlePhotoInput(document.getElementById("photoUploadInput"), entry.photos, photoGrid, Camera.processUploadedPhoto);
  if (showFix) {
    handlePhotoInput(document.getElementById("fixPhotoInput"), entry.fix.photos, fixPhotoGrid, Camera.processCapturedPhoto);
    handlePhotoInput(document.getElementById("fixPhotoUploadInput"), entry.fix.photos, fixPhotoGrid, Camera.processUploadedPhoto);
  }

  document.getElementById("formEntry").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    entry.title = document.getElementById("entryTitle").value.trim();
    entry.description = document.getElementById("entryDescription").value.trim();
    if (showFix) entry.fix.description = document.getElementById("fixDescription").value.trim();
    project.updatedAt = new Date().toISOString();
    await DB.saveProject(project);
    showToast("Gespeichert");
    navigate("project", { id: project.id }, { replace: true });
  });

  document.getElementById("btnDeleteEntry").addEventListener("click", async () => {
    if (!confirm("Diesen Eintrag wirklich löschen?")) return;
    project.entries = project.entries.filter(e => e.id !== entry.id);
    await DB.saveProject(project);
    showToast("Eintrag gelöscht");
    navigate("project", { id: project.id }, { replace: true });
  });
}

// ======================================================= EDIT PROJECT

async function renderEditProject(id) {
  const project = await DB.getProject(id);
  if (!project) { navigate("home", {}, { replace: true }); return; }

  setHeader("Projekt bearbeiten", true);
  const tpl = document.getElementById("tpl-edit-project");
  appEl.appendChild(tpl.content.cloneNode(true));

  document.getElementById("editTitle").value = project.title || "";
  document.getElementById("editTermin").value = project.termin || "";
  document.getElementById("editTeilnehmer").value = (project.teilnehmer || []).join("\n");
  document.getElementById("editDeadline").value = project.deadline || "";
  document.getElementById("editSignedBy").value = project.signedBy || "";
  document.getElementById("editSignedDate").value = project.signedDate || "";
  document.getElementById("editNotesAuthor").value = project.notesAuthor || "";
  document.getElementById("editNotes").value = project.notes || "";

  document.getElementById("formEditProject").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    project.title = fd.get("title").trim();
    project.termin = fd.get("termin") || "";
    project.teilnehmer = fd.get("teilnehmer").split("\n").map(s => s.trim()).filter(Boolean);
    project.deadline = fd.get("deadline") || "";
    project.signedBy = fd.get("signedBy").trim();
    project.signedDate = fd.get("signedDate") || "";
    project.notesAuthor = fd.get("notesAuthor").trim();
    project.notes = fd.get("notes").trim();
    project.updatedAt = new Date().toISOString();
    await DB.saveProject(project);
    showToast("Gespeichert");
    navigate("project", { id: project.id }, { replace: true });
  });
}

// ============================================================ SETTINGS

async function renderSettings() {
  setHeader("Firmenprofil", true);
  const tpl = document.getElementById("tpl-settings");
  appEl.appendChild(tpl.content.cloneNode(true));

  const settings = await DB.getSettings();
  document.getElementById("settingsCompanyName").value = settings.companyName || "";

  const previewWrap = document.getElementById("logoPreviewWrap");
  const previewImg = document.getElementById("logoPreview");
  let currentLogoDataUrl = settings.logoDataUrl || "";

  function refreshPreview() {
    previewWrap.hidden = !currentLogoDataUrl;
    if (currentLogoDataUrl) previewImg.src = currentLogoDataUrl;
  }
  refreshPreview();

  document.getElementById("settingsLogoInput").addEventListener("change", (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      currentLogoDataUrl = reader.result;
      refreshPreview();
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("btnRemoveLogo").addEventListener("click", () => {
    currentLogoDataUrl = "";
    refreshPreview();
  });

  document.getElementById("formSettings").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await DB.saveSettings({
      companyName: document.getElementById("settingsCompanyName").value.trim(),
      logoDataUrl: currentLogoDataUrl
    });
    showToast("Firmenprofil gespeichert");
    goBack();
  });
}

// ============================================================= ACCOUNT

btnAccount.addEventListener("click", async () => {
  if (!Drive.isConfigured()) {
    showToast("Drive ist nicht eingerichtet — siehe README.md, Abschnitt „Google Drive einrichten“");
    return;
  }
  if (Drive.isSignedIn()) {
    if (confirm("Von Google Drive trennen?")) {
      Drive.signOut();
      showToast("Getrennt");
      if (currentScreen.name === "home") render("home", {});
    }
    return;
  }
  try {
    await Drive.signIn();
    showToast("Mit Google Drive verbunden");
    await syncFromDrive();
    if (currentScreen.name === "home") render("home", {});
  } catch (e) {
    showToast(e.message || "Verbindung fehlgeschlagen");
  }
});

// ============================================================= BOOT

navigate("home", {}, { replace: true });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
