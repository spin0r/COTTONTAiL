// === DOM References ===
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const fileList = document.getElementById("file-list");
const uploadBtn = document.getElementById("upload-btn");
const progressWrap = document.getElementById("progress-wrap");
const progressFill = document.getElementById("progress-fill");
const progressPct = document.getElementById("progress-pct");
const status = document.getElementById("status");
const resetLink = document.getElementById("reset-link");
const driveFiles = document.getElementById("drive-files");
const modalOverlay = document.getElementById("confirm-modal");
const modalRemember = document.getElementById("modal-remember");
const magicAllBtn = document.getElementById("magic-all-btn");

let selectedFiles = [];
let modalCallback = null;

const ICONS = {
  wait: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  upload: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  success: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  error: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  edit: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
  save: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
  cookie: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M7 10h.01"/><path d="M10 14h.01"/><path d="M15 13h.01"/><path d="M12 7h.01"/></svg>',
  time: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  warning: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  smart: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.5 22l6.5-6.5"/><path d="M13.5 10.5l-3-3"/><path d="M14 6l4-4 4 4-4 4"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
};

// === Paste Handler ===
window.addEventListener("paste", (e) => {
  if (!fileInput) return;
  const items = (e.clipboardData || e.originalEvent.clipboardData).items;
  const files = [];
  for (const item of items) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length > 0) {
    handleFiles(files);
  }
});

// === Drag & Drop ===
if (dropZone) {
  ["dragenter", "dragover"].forEach((e) => {
    dropZone.addEventListener(e, (ev) => {
      ev.preventDefault();
      dropZone.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((e) => {
    dropZone.addEventListener(e, (ev) => {
      ev.preventDefault();
      dropZone.classList.remove("drag-over");
    });
  });
  dropZone.addEventListener("drop", (ev) => {
    const files = ev.dataTransfer.files;
    if (files.length) handleFiles(files);
  });
}

if (fileInput) {
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) handleFiles(fileInput.files);
  });
}

// === Initial Load ===
if (driveFiles) loadDriveFiles();
loadAccountInfo();

// Auto-refresh account info every 30s (picks up cookie changes from bot)
setInterval(loadAccountInfo, 30000);

// === Account Info ===
async function loadAccountInfo() {
  const bar = document.getElementById("account-bar");
  try {
    const res = await fetch("/health");
    const data = await res.json();
    if (res.ok && data.status === "ok") {
      bar.innerHTML = `<span class="account-label">@${data.bot}</span><span class="account-sep">•</span><span class="account-detail" style="display:inline-flex;align-items:center;gap:4px;">${ICONS.cookie} ${data.profile}${data.email ? ` (${data.email})` : ""}</span><span class="account-sep">•</span><span class="account-detail" style="display:inline-flex;align-items:center;gap:4px;">${ICONS.time} <span id="sidebar-uptime">${data.uptime}</span></span>`;
      bar.classList.remove("error");
    } else {
      bar.innerHTML = `<span style="color:#f87171;display:inline-flex;align-items:center;gap:4px;">${ICONS.warning} Bot offline</span>`;
      bar.classList.add("error");
    }
  } catch (err) {
    bar.innerHTML = `<span style="color:#f87171;display:inline-flex;align-items:center;gap:4px;">${ICONS.warning} Could not connect</span>`;
    bar.classList.add("error");
  }
}

// === File Selection ===
function handleFiles(files) {
  selectedFiles = [];
  fileList.innerHTML = "";
  let rejected = 0;

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".nzb")) {
      rejected++;
      continue;
    }
    selectedFiles.push(file);
    const idx = selectedFiles.length;
    const item = document.createElement("div");
    item.className = "file-item";
    item.id = "fi-" + idx;
    item.innerHTML = `
      <div class="f-info">
        <span class="fname">${file.name}</span>
        <span class="fsize">${formatSize(file.size)}</span>
        <span class="fstatus" id="fs-${idx}">${ICONS.wait}</span>
      </div>
      <div class="f-progress-wrap" id="fpw-${idx}">
        <div class="f-progress-bar"><div class="f-fill" id="ffill-${idx}"></div></div>
        <div class="f-text" id="ftext-${idx}">Waiting...</div>
      </div>
    `;
    fileList.appendChild(item);
  }

  if (rejected > 0 && selectedFiles.length === 0) {
    showStatus(`Only .nzb files are allowed. (${rejected} rejected)`, "error");
    return;
  }
  if (rejected > 0) {
    showStatus(`${rejected} non-.nzb file(s) skipped.`, "error");
  }

  if (selectedFiles.length > 0) {
    fileList.classList.add("visible");
    uploadBtn.classList.add("visible");
    status.classList.remove("visible");
    resetLink.classList.remove("visible");
  }
}

// === Upload to Server ===
if (uploadBtn) uploadBtn.addEventListener("click", async () => {
  if (!selectedFiles.length) return;
  uploadBtn.disabled = true;
  status.classList.remove("visible");

  let success = 0,
    failed = 0;

  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    const idx = i + 1;
    const item = document.getElementById("fi-" + idx);
    const fstat = document.getElementById("fs-" + idx);

    if (item) item.className = "file-item uploading";
    if (fstat) fstat.innerHTML = ICONS.upload;

    const overallPct = Math.round((i / selectedFiles.length) * 100);
    progressFill.style.width = overallPct + "%";
    progressPct.textContent = `${i + 1}/${selectedFiles.length}`;

    try {
      await uploadSingleFile(file, idx);
      success++;
      if (item) item.className = "file-item done";
      if (fstat) fstat.innerHTML = ICONS.success;
      // Refresh drive files immediately as soon as one file finishes
      loadDriveFiles();
    } catch (err) {
      failed++;
      if (item) item.className = "file-item failed";
      if (fstat) fstat.innerHTML = ICONS.error;
    }
  }

  // Removed overall progress bar update

  if (failed === 0) {
    showStatus(`All ${success} file(s) uploaded!`, "success");
    setTimeout(() => {
      fileList.innerHTML = "";
      fileList.classList.remove("visible");
      uploadBtn.classList.remove("visible");
      selectedFiles = [];
      fileInput.value = "";
    }, 2000);
  } else {
    showStatus(
      `${success} uploaded, ${failed} failed.`,
      failed === selectedFiles.length ? "error" : "success",
    );
  }
  uploadBtn.disabled = false;
  resetLink.classList.add("visible");
});

function uploadSingleFile(file, idx) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);

    const fWrap = document.getElementById("fpw-" + idx);
    const fFill = document.getElementById("ffill-" + idx);
    const fText = document.getElementById("ftext-" + idx);
    
    if (fWrap) fWrap.style.display = "block";

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && fFill && fText) {
        let pct = 0;
        if (e.total > 0) pct = Math.round((e.loaded / e.total) * 100);
        fFill.style.width = pct + "%";
        fText.textContent = `${pct}% (${formatSize(e.loaded)} / ${formatSize(e.total)})`;
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status === 200) resolve();
      else reject(new Error("Status " + xhr.status));
    });
    xhr.addEventListener("error", () => reject(new Error("Network error")));

    xhr.open("POST", "/upload");
    xhr.send(formData);
  });
}

// === Helpers ===
function showStatus(msg, type) {
  status.textContent = msg;
  status.className = "status visible " + type;
}

function resetForm() {
  selectedFiles = [];
  fileInput.value = "";
  fileList.innerHTML = "";
  fileList.classList.remove("visible");
  uploadBtn.classList.remove("visible");
  progressWrap.classList.remove("visible");
  progressFill.style.width = "0%";
  progressPct.textContent = "0%";
  status.classList.remove("visible");
  resetLink.classList.remove("visible");
}

function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// === Drive Files Management ===
async function loadDriveFiles() {
  try {
    const res = await fetch("/files");
    const data = await res.json();
    renderDriveFiles(data);
  } catch (err) {
    console.error("Failed to load files", err);
  }
}

function renderDriveFiles(files) {
  driveFiles.innerHTML = "";
  files.forEach((f) => {
    const isRecent = (Date.now() / 1000 - f.mtime) < 3600;
    const item = document.createElement("div");
    item.className = `drive-item ${isRecent ? "recent" : ""}`;
    item.innerHTML = `
            <div class="d-name" title="${f.name}">${f.name}</div>
            <div class="d-size">${formatSize(f.size)}</div>
            <button class="action-btn magic" title="Upload to MagicNZB" data-filename="${f.name}" onclick="uploadToMagic('${f.name.replace(/'/g, "\\'")}', this)">${ICONS.upload}</button>
            <button class="action-btn" title="Smart Rename" onclick="smartRename(this, '${f.name.replace(/'/g, "\\'")}')">${ICONS.smart}</button>
            <button class="action-btn" title="Edit" onclick="startEdit(this, '${f.name.replace(/'/g, "\\'")}')">${ICONS.edit}</button>
            <button class="action-btn delete" title="Delete" onclick="confirmDelete('${f.name.replace(/'/g, "\\'")}')">${ICONS.trash}</button>
        `;
    item.dataset.filename = f.name;
    driveFiles.appendChild(item);
  });
}

// === Edit / Rename ===
function startEdit(btn, oldName) {
  const item = btn.closest(".drive-item");
  const nameEl = item.querySelector(".d-name");
  const baseName = oldName.replace(/\.nzb$/i, "");

  nameEl.outerHTML = `<input type="text" class="edit-input" value="${baseName}" />`;
  const input = item.querySelector(".edit-input");
  input.focus();

  btn.outerHTML = `<button class="action-btn save" title="Save" onclick="saveEdit(this, '${oldName.replace(/'/g, "\\'")}')">${ICONS.save}</button>`;

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") item.querySelector(".save").click();
    if (e.key === "Escape") loadDriveFiles();
  });
}

async function saveEdit(btn, oldName) {
  const item = btn.closest(".drive-item");
  const input = item.querySelector(".edit-input");
  let newName = input.value.trim();

  if (!newName || newName === oldName.replace(/\.nzb$/i, "")) {
    loadDriveFiles();
    return;
  }

  try {
    const res = await fetch(`/files/${encodeURIComponent(oldName)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_name: newName }),
    });
    if (res.ok) {
      loadDriveFiles();
    } else {
      const data = await res.json();
      alert(data.error || "Failed to rename");
      loadDriveFiles();
    }
  } catch (err) {
    console.error(err);
    loadDriveFiles();
  }
}

// === Delete ===
async function doDeleteFile(filename) {
  try {
    const res = await fetch(`/files/${encodeURIComponent(filename)}`, {
      method: "DELETE",
    });
    if (res.ok) loadDriveFiles();
  } catch (err) {
    console.error(err);
  }
}

async function doClearAll() {
  try {
    const res = await fetch(`/files`, { method: "DELETE" });
    if (res.ok) loadDriveFiles();
  } catch (err) {
    console.error(err);
  }
}

async function smartRename(btn, filename) {
  if (btn.classList.contains("uploading")) return;
  btn.classList.add("uploading");
  const oldIcon = btn.innerHTML;
  btn.innerHTML = ICONS.wait;

  try {
    const res = await fetch(`/smart-rename/${encodeURIComponent(filename)}`, { method: "POST" });
    const data = await res.json();

    if (res.ok) {
      loadDriveFiles();
    } else {
      alert(data.error || "Failed to smart rename");
      btn.classList.remove("uploading");
      btn.innerHTML = oldIcon;
    }
  } catch (err) {
    console.error(err);
    alert("Network error");
    btn.classList.remove("uploading");
    btn.innerHTML = oldIcon;
  }
}

// === Upload to MagicNZB (per file) ===
async function uploadToMagic(filename, btn) {
  if (btn.classList.contains("uploading") || btn.classList.contains("done"))
    return;

  btn.classList.add("uploading");
  btn.innerHTML = ICONS.wait;

  try {
    const res = await fetch(
      `/upload-to-magic/${encodeURIComponent(filename)}`,
      { method: "POST" },
    );
    const data = await res.json();

    if (res.ok && data.status === "success") {
      btn.classList.remove("uploading");
      btn.classList.add("done");
      btn.innerHTML = ICONS.success;
    } else {
      btn.classList.remove("uploading");
      btn.classList.add("failed");
      btn.innerHTML = ICONS.error;
      btn.title = data.error || "Upload failed";
    }
  } catch (err) {
    btn.classList.remove("uploading");
    btn.classList.add("failed");
    btn.innerHTML = ICONS.error;
    btn.title = "Network error";
  }
}

// === Upload All to MagicNZB ===
async function uploadAllToMagic() {
  const items = driveFiles.querySelectorAll(".drive-item");
  if (items.length === 0) return;

  magicAllBtn.disabled = true;
  magicAllBtn.innerHTML = `${ICONS.wait} <span style="margin-left:4px">Uploading...</span>`;

  let success = 0,
    failed = 0;

  for (const item of items) {
    const btn = item.querySelector(".action-btn.magic");
    const filename = item.dataset.filename;

    if (!btn || btn.classList.contains("done")) {
      success++;
      continue;
    }

    await uploadToMagic(filename, btn);

    if (btn.classList.contains("done")) success++;
    else failed++;
  }

  magicAllBtn.disabled = false;
  const magicHtml = `${ICONS.upload} <span style="margin-left:4px">Upload All</span>`;
  
  if (failed === 0) {
    magicAllBtn.innerHTML = `${ICONS.success} <span style="margin-left:4px">All ${success} uploaded!</span>`;
    setTimeout(() => {
      magicAllBtn.innerHTML = magicHtml;
    }, 3000);
  } else {
    magicAllBtn.innerHTML = `${ICONS.error} <span style="margin-left:4px">${success} ok, ${failed} failed</span>`;
    setTimeout(() => {
      magicAllBtn.innerHTML = magicHtml;
    }, 3000);
  }
}

// === Modal Logic ===
function showModal(title, desc, callback) {
  if (localStorage.getItem("skipConfirmations") === "true") {
    callback();
    return;
  }

  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-desc").textContent = desc;

  modalRemember.checked = false;
  modalCallback = callback;
  modalOverlay.classList.add("visible");
}

function closeModal() {
  modalOverlay.classList.remove("visible");
  modalCallback = null;
}

const _modalConfirmBtn = document.getElementById("modal-confirm-btn");
if (_modalConfirmBtn) _modalConfirmBtn.addEventListener("click", () => {
  if (modalRemember.checked) {
    localStorage.setItem("skipConfirmations", "true");
  }

  if (modalCallback) modalCallback();
  closeModal();
});

function confirmDelete(filename) {
  showModal(
    "Delete File",
    `Are you sure you want to delete "${filename}"?`,
    () => doDeleteFile(filename),
  );
}

function confirmClearAll() {
  const count = driveFiles.children.length;
  if (count === 0) return;

  showModal(
    "Clear All Files",
    `Are you sure you want to delete all ${count} files in the drive?`,
    () => doClearAll(),
  );
}

// === Resizer Logic ===
const resizer = document.getElementById("resizer");
const sidebar = document.querySelector(".sidebar");
let isDraggingResizer = false;

if (resizer && sidebar) {
  resizer.addEventListener("mousedown", (e) => {
    isDraggingResizer = true;
    resizer.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDraggingResizer) return;
    let newWidth = e.clientX;
    if (newWidth < 250) newWidth = 250;
    if (newWidth > window.innerWidth - 300) newWidth = window.innerWidth - 300;
    sidebar.style.width = newWidth + "px";
  });

  document.addEventListener("mouseup", () => {
    if (isDraggingResizer) {
      isDraggingResizer = false;
      resizer.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  });
}
