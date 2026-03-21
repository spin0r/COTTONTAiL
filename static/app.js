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

// === Paste Handler ===
window.addEventListener("paste", (e) => {
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

fileInput.addEventListener("change", () => {
  if (fileInput.files.length) handleFiles(fileInput.files);
});

// === Initial Load ===
loadDriveFiles();
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
      bar.innerHTML = `<span class="account-label">@${data.bot}</span><span class="account-sep">•</span><span class="account-detail">🍪 ${data.profile}${data.email ? ` (${data.email})` : ""}</span><span class="account-sep">•</span><span class="account-detail">⏱ ${data.uptime}</span>`;
      bar.classList.remove("error");
    } else {
      bar.innerHTML = '<span style="color:#f87171">⚠ Bot offline</span>';
      bar.classList.add("error");
    }
  } catch (err) {
    bar.innerHTML = '<span style="color:#f87171">⚠ Could not connect</span>';
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
    const item = document.createElement("div");
    item.className = "file-item";
    item.id = "fi-" + selectedFiles.length;
    item.innerHTML = `<span class="fname">${file.name}</span><span class="fsize">${formatSize(file.size)}</span><span class="fstatus" id="fs-${selectedFiles.length}">⏳</span>`;
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
uploadBtn.addEventListener("click", async () => {
  if (!selectedFiles.length) return;
  uploadBtn.disabled = true;
  progressWrap.classList.add("visible");
  status.classList.remove("visible");

  let success = 0,
    failed = 0;

  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    const idx = i + 1;
    const item = document.getElementById("fi-" + idx);
    const fstat = document.getElementById("fs-" + idx);

    if (item) item.className = "file-item uploading";
    if (fstat) fstat.textContent = "⏫";

    const overallPct = Math.round((i / selectedFiles.length) * 100);
    progressFill.style.width = overallPct + "%";
    progressPct.textContent = `${i + 1}/${selectedFiles.length}`;

    try {
      await uploadSingleFile(file);
      success++;
      if (item) item.className = "file-item done";
      if (fstat) fstat.textContent = "✅";
    } catch (err) {
      failed++;
      if (item) item.className = "file-item failed";
      if (fstat) fstat.textContent = "❌";
    }
  }

  progressFill.style.width = "100%";
  progressPct.textContent = `${selectedFiles.length}/${selectedFiles.length}`;

  if (failed === 0) {
    showStatus(`✅ All ${success} file(s) uploaded!`, "success");
    setTimeout(() => {
      fileList.innerHTML = "";
      fileList.classList.remove("visible");
      uploadBtn.classList.remove("visible");
      progressWrap.classList.remove("visible");
      progressFill.style.width = "0%";
      progressPct.textContent = "0%";
      selectedFiles = [];
      fileInput.value = "";
    }, 2000);
    loadDriveFiles();
  } else {
    showStatus(
      `${success} uploaded, ${failed} failed.`,
      failed === selectedFiles.length ? "error" : "success",
    );
    if (success > 0) loadDriveFiles();
  }
  uploadBtn.disabled = false;
  resetLink.classList.add("visible");
});

function uploadSingleFile(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);

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
    const item = document.createElement("div");
    item.className = "drive-item";
    item.innerHTML = `
            <div class="d-name" title="${f.name}">${f.name}</div>
            <div class="d-size">${formatSize(f.size)}</div>
            <button class="action-btn magic" title="Upload to MagicNZB" data-filename="${f.name}" onclick="uploadToMagic('${f.name.replace(/'/g, "\\'")}', this)">⬆️</button>
            <button class="action-btn" title="Edit" onclick="startEdit(this, '${f.name.replace(/'/g, "\\'")}')">✏️</button>
            <button class="action-btn delete" title="Delete" onclick="confirmDelete('${f.name.replace(/'/g, "\\'")}')">🗑️</button>
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

  btn.outerHTML = `<button class="action-btn save" title="Save" onclick="saveEdit(this, '${oldName.replace(/'/g, "\\'")}')">💾</button>`;

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

// === Upload to MagicNZB (per file) ===
async function uploadToMagic(filename, btn) {
  if (btn.classList.contains("uploading") || btn.classList.contains("done"))
    return;

  btn.classList.add("uploading");
  btn.textContent = "⏳";

  try {
    const res = await fetch(
      `/upload-to-magic/${encodeURIComponent(filename)}`,
      { method: "POST" },
    );
    const data = await res.json();

    if (res.ok && data.status === "success") {
      btn.classList.remove("uploading");
      btn.classList.add("done");
      btn.textContent = "✅";
    } else {
      btn.classList.remove("uploading");
      btn.classList.add("failed");
      btn.textContent = "❌";
      btn.title = data.error || "Upload failed";
    }
  } catch (err) {
    btn.classList.remove("uploading");
    btn.classList.add("failed");
    btn.textContent = "❌";
    btn.title = "Network error";
  }
}

// === Upload All to MagicNZB ===
async function uploadAllToMagic() {
  const items = driveFiles.querySelectorAll(".drive-item");
  if (items.length === 0) return;

  magicAllBtn.disabled = true;
  magicAllBtn.textContent = "Uploading...";

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
  if (failed === 0) {
    magicAllBtn.textContent = `✅ All ${success} uploaded!`;
    setTimeout(() => {
      magicAllBtn.textContent = "⬆️ Upload All to MagicNZB";
    }, 3000);
  } else {
    magicAllBtn.textContent = `${success} ok, ${failed} failed`;
    setTimeout(() => {
      magicAllBtn.textContent = "⬆️ Upload All to MagicNZB";
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

document.getElementById("modal-confirm-btn").addEventListener("click", () => {
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
