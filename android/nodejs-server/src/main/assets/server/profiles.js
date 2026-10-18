/* ===== Profiles — Netflix-style "Who's watching?" profiles =====
   Each profile has its own accent color, Continue Watching list, and manga
   reading progress. Everything else (TMDB key, manga proxy, reader mode) is
   shared across the whole app. */

const MAX_PROFILES = 5;
const PROFILE_COLORS = [
  "#e50914", "#ff9000", "#ffd60a", "#1db954",
  "#00c2a8", "#00a8e1", "#a259ff", "#ff5e7e",
];

const profileStore = {
  get list() {
    const v = JSON.parse(localStorage.getItem("fh_profiles") || "null");
    return Array.isArray(v) && v.length ? v : null;
  },
  set list(v) { localStorage.setItem("fh_profiles", JSON.stringify(v)); scheduleBackup(); },
  get activeId() { return localStorage.getItem("fh_active_profile"); },
  set activeId(v) { localStorage.setItem("fh_active_profile", v); },
};

function pEsc(s) { return (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* ---------- App-wide settings (theme, shortcuts, per-profile prefs) ---------- */
const settingsStore = {
  // GLOBAL — theme is a device/window-level preference, not per-profile
  get theme() { return localStorage.getItem("fh_theme") || "dark"; },
  set theme(v) { localStorage.setItem("fh_theme", v); applyTheme(v); scheduleBackup(); },

  // GLOBAL — escape hatch for the keyboard shortcut listener
  get shortcutsEnabled() { return localStorage.getItem("fh_shortcuts") !== "false"; },
  set shortcutsEnabled(v) { localStorage.setItem("fh_shortcuts", v ? "true" : "false"); scheduleBackup(); },

  // PER-PROFILE — manga reader defaults (migrates the old global mdx_mode/
  // mdx_quality keys the first time this is read for a given profile)
  get readerPrefs() {
    const stored = JSON.parse(localStorage.getItem(pkey("fh_reader_prefs")) || "null");
    if (stored) return stored;
    const migrated = {
      mode: localStorage.getItem("mdx_mode") || "strip",
      quality: localStorage.getItem("mdx_quality") || "saver",
      direction: "ltr",
    };
    return migrated;
  },
  set readerPrefs(v) { localStorage.setItem(pkey("fh_reader_prefs"), JSON.stringify(v)); scheduleBackup(); },

  // PER-PROFILE — default playback server
  get playbackPrefs() {
    return JSON.parse(localStorage.getItem(pkey("fh_playback_prefs")) || "null") || { preferredSourceIndex: 0 };
  },
  set playbackPrefs(v) { localStorage.setItem(pkey("fh_playback_prefs"), JSON.stringify(v)); scheduleBackup(); },
};

// Apply the chosen theme (dark is the default :root, others are
// html[data-theme="..."] overrides in styles.css). Also keeps --accent-soft
// in sync with the active profile's accent color regardless of theme.
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme === "dark" ? "" : theme);
  setAccentVars(getActiveProfile().color);
}

// Sets --accent and a matching --accent-soft (accent + alpha) together —
// keeps the soft glow color in sync whenever the accent changes.
function setAccentVars(color) {
  document.documentElement.style.setProperty("--accent", color);
  document.documentElement.style.setProperty("--accent-soft", color + "2e");
}

/* ---------- Disk backup of localStorage ----------
   localStorage alone has been lost across app updates/reinstalls in the past.
   Mirror it to a file on disk (server-side, in userData — see server.js) and
   restore any missing keys from it on boot. */
let backupTimer = null;
function scheduleBackup() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    const snapshot = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      snapshot[k] = localStorage.getItem(k);
    }
    fetch("/__backup", { method: "POST", body: JSON.stringify(snapshot) }).catch(() => {});
    if (typeof scheduleSyncPush === "function") scheduleSyncPush();
  }, 1500);
}

// Fill in any localStorage keys that are missing but present in the on-disk
// backup. Never overwrites existing data — only restores gaps.
async function restoreBackup() {
  try {
    const res = await fetch("/__backup");
    const snapshot = await res.json();
    let restored = false;
    for (const [k, v] of Object.entries(snapshot)) {
      if (localStorage.getItem(k) == null) { localStorage.setItem(k, v); restored = true; }
    }
    if (restored) scheduleBackup(); // re-save a merged copy
  } catch {}
}

// Per-profile localStorage key, e.g. pkey("vk_watching") -> "vk_watching::p1"
function pkey(base) { return `${base}::${getActiveProfile().id}`; }

// First run: create a default profile, migrating any existing (pre-profiles)
// watch history / manga progress / accent color onto it.
function ensureProfiles() {
  let list = profileStore.list;
  if (!list) {
    const id = "p1";
    const legacyColor = localStorage.getItem("vk_color");
    list = [{ id, name: "Profile 1", color: (legacyColor && legacyColor !== "#e50914") ? legacyColor : "#ff9000" }];
    profileStore.list = list;
    profileStore.activeId = id;
    const watching = localStorage.getItem("vk_watching");
    if (watching != null) localStorage.setItem(`vk_watching::${id}`, watching);
    const reading = localStorage.getItem("mdx_reading");
    if (reading != null) localStorage.setItem(`mdx_reading::${id}`, reading);
    scheduleBackup();
  }
  if (!list.find(p => p.id === profileStore.activeId)) profileStore.activeId = list[0].id;
  return list;
}

function getActiveProfile() {
  const list = ensureProfiles();
  return list.find(p => p.id === profileStore.activeId) || list[0];
}

/* ---------- "Who's watching?" screen ---------- */
let manageMode = false;
let editingProfileId = null;
// Data-URL of the picked-but-not-yet-saved avatar while the modal is open
let pendingAvatar; // string | null (null = "leave as is", "" = remove)

function renderProfileScreen() {
  const list = ensureProfiles();
  const grid = document.getElementById("profileGrid");
  const tiles = list.map(p => {
    const action = manageMode ? `openProfileModal('${p.id}')` : `selectProfile('${p.id}')`;
    const avatarInner = p.avatar
      ? `<img src="${p.avatar}" alt="">`
      : `<span>${pEsc((p.name[0] || "?").toUpperCase())}</span>`;
    return `
    <div class="profile-tile" onclick="${action}">
      <div class="profile-avatar" style="background:${p.color}">
        ${avatarInner}
        ${manageMode ? '<div class="profile-edit-overlay">✎</div>' : ""}
      </div>
      <div class="profile-name">${pEsc(p.name)}</div>
    </div>`;
  }).join("");
  const addTile = list.length < MAX_PROFILES && !manageMode
    ? `<div class="profile-tile" onclick="openProfileModal(null)">
         <div class="profile-avatar add-avatar">+</div>
         <div class="profile-name">Add Profile</div>
       </div>`
    : "";
  grid.innerHTML = tiles + addTile;
  document.getElementById("manageProfilesBtn").textContent = manageMode ? "Done" : "Manage Profiles";
}

function toggleManageProfiles() {
  manageMode = !manageMode;
  renderProfileScreen();
}

// Full picker — used at startup and from the topbar switcher
function showProfileScreen() {
  manageMode = false;
  renderProfileScreen();
  document.getElementById("profileScreen").classList.remove("hidden");
}

function selectProfile(id) {
  profileStore.activeId = id;
  document.getElementById("profileScreen").classList.add("hidden");
  applyProfile();
}

function applyProfile() {
  const p = getActiveProfile();
  setAccentVars(p.color);
  updateProfileButton();
  if (typeof initApp === "function") initApp();
}

function updateProfileButton() {
  const p = getActiveProfile();
  const btn = document.getElementById("profileBtn");
  if (!btn) return;
  btn.style.background = p.color;
  if (p.avatar) {
    btn.textContent = "";
    btn.style.backgroundImage = `url("${p.avatar}")`;
    btn.style.backgroundSize = "cover";
    btn.style.backgroundPosition = "center";
  } else {
    btn.style.backgroundImage = "";
    btn.textContent = (p.name[0] || "?").toUpperCase();
  }
  btn.title = p.name;
}

/* ---------- Add / edit / delete profile modal ---------- */
function openProfileModal(id) {
  editingProfileId = id;
  const list = ensureProfiles();
  const p = id ? list.find(x => x.id === id) : null;
  pendingAvatar = undefined;
  document.getElementById("profileModalTitle").textContent = p ? "Edit Profile" : "Add Profile";
  document.getElementById("profileNameInput").value = p ? p.name : "";
  document.getElementById("avatarRemoveBtn").classList.toggle("hidden", !p || !p.avatar);
  renderAvatarPreview(p ? p.avatar : null, p ? p.color : PROFILE_COLORS[0]);
  renderColorGrid(p ? p.color : PROFILE_COLORS[0]);
  document.getElementById("profileDeleteBtn").classList.toggle("hidden", !p || list.length <= 1);
  document.getElementById("profileModal").classList.remove("hidden");
}

// Draw the chosen image into a small square canvas and export as JPEG —
// full-res photos would blow up localStorage (and the backup file).
function pickAvatarFile(file) {
  if (!file || !/^image\//.test(file.type)) return;
  const img = new Image();
  img.onload = () => {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    // center-crop to square so nothing gets squashed
    const side = Math.min(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    pendingAvatar = canvas.toDataURL("image/jpeg", 0.82);
    renderAvatarPreview(pendingAvatar, currentModalColor());
    document.getElementById("avatarRemoveBtn").classList.remove("hidden");
  };
  img.src = URL.createObjectURL(file);
}

function currentModalColor() {
  const swatch = document.querySelector(".profile-color-swatch.selected");
  return swatch ? swatch.dataset.color : PROFILE_COLORS[0];
}

function renderAvatarPreview(avatar, color) {
  const wrap = document.getElementById("avatarPreview");
  wrap.style.background = color;
  wrap.innerHTML = avatar
    ? `<img src="${avatar}" alt="">`
    : `<span>${pEsc((document.getElementById("profileNameInput").value.trim()[0] || "?").toUpperCase())}</span>`;
}

function removeAvatar() {
  pendingAvatar = "";
  renderAvatarPreview(null, currentModalColor());
  document.getElementById("avatarRemoveBtn").classList.add("hidden");
}

function renderColorGrid(selected) {
  const grid = document.getElementById("profileColorGrid");
  grid.innerHTML = PROFILE_COLORS.map(c =>
    `<div class="profile-color-swatch ${c === selected ? "selected" : ""}" style="background:${c}" data-color="${c}" onclick="selectColorSwatch('${c}')"></div>`
  ).join("");
}
function selectColorSwatch(c) {
  document.querySelectorAll(".profile-color-swatch").forEach(el => el.classList.toggle("selected", el.dataset.color === c));
}

function closeProfileModal() {
  document.getElementById("profileModal").classList.add("hidden");
  editingProfileId = null;
}

function saveProfileModal() {
  const name = document.getElementById("profileNameInput").value.trim() || "Profile";
  const swatch = document.querySelector(".profile-color-swatch.selected");
  const color = swatch ? swatch.dataset.color : PROFILE_COLORS[0];
  let list = ensureProfiles();
  if (editingProfileId) {
    const p = list.find(x => x.id === editingProfileId);
    p.name = name; p.color = color;
    p.modified = Date.now(); // sync rooms: newest edit wins across devices
    if (pendingAvatar !== undefined) {
      if (pendingAvatar) p.avatar = pendingAvatar;
      else delete p.avatar;
    }
  } else {
    if (list.length >= MAX_PROFILES) return;
    const np = { id: "p" + Date.now(), name, color };
    if (pendingAvatar) np.avatar = pendingAvatar;
    list.push(np);
  }
  profileStore.list = list;
  closeProfileModal();
  renderProfileScreen();
  if (profileStore.activeId === editingProfileId) applyProfile();
}

function deleteProfileConfirm() {
  const list = ensureProfiles();
  if (list.length <= 1 || !editingProfileId) return;
  if (!confirm("Delete this profile? Its watch history and manga progress will be lost.")) return;
  const removedId = editingProfileId;
  const next = list.filter(x => x.id !== removedId);
  profileStore.list = next;
  localStorage.removeItem(`vk_watching::${removedId}`);
  localStorage.removeItem(`mdx_reading::${removedId}`);
  if (profileStore.activeId === removedId) profileStore.activeId = next[0].id;
  closeProfileModal();
  renderProfileScreen();
}

/* ---------- Boot ---------- */
(async function bootProfiles() {
  await restoreBackup();
  ensureProfiles();
  applyTheme(settingsStore.theme);
  showProfileScreen();
})();
