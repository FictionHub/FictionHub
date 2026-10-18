/* ===== Online profile sync — "sync rooms" =====
   Devices that join the same room share profiles and Continue Watching /
   Reading progress, so e.g. a friend's profile appears on your device and
   yours on theirs — one shared account across machines.

   How it works:
   - A room is a JSON document on textdb.online (free, no account): POST to
     /update/<id>/ writes, GET /<id>/ reads. Requests go through the local
     proxy, so there are no CORS issues. The id is an unguessable random
     string — that's the write/read authorization, and the payload itself is
     additionally encrypted end-to-end (see below), so the storage service
     only ever sees ciphertext.
   - The document is encrypted with AES-GCM using a key derived (PBKDF2) from
     the room's passphrase.
   - The room code ("<roomId>|<passphrase>") is what you share with a friend.
   - Merging: profiles are matched by NAME across devices (same name = same
     profile, newer color/avatar wins); per-title watch/read entries merge by
     newest timestamp. Each device pulls, merges, applies locally, and pushes
     the merged document — entry-level timestamps make this convergent.
   - v1 limitation: deleting a profile locally does not delete it from the
     room (it would reappear on the next merge). */

const SYNC_POLL_MS = 5 * 60 * 1000;

const syncStore = {
  get room() { try { return JSON.parse(localStorage.getItem("fh_sync_room") || "null"); } catch { return null; } },
  set room(v) { localStorage.setItem("fh_sync_room", JSON.stringify(v)); scheduleBackup(); },
  get lastSync() { return +localStorage.getItem("fh_sync_last") || 0; },
  set lastSync(v) { localStorage.setItem("fh_sync_last", String(v)); },
};

function syncDeviceId() {
  let d = localStorage.getItem("fh_device_id");
  if (!d) {
    d = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    localStorage.setItem("fh_device_id", d);
  }
  return d;
}
function syncDeviceName() { return localStorage.getItem("fh_device_name") || "This device"; }

/* ---------- crypto helpers ---------- */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ub64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

async function syncKey(passphrase, blobId) {
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new TextEncoder().encode("fictionhub-sync:" + blobId), iterations: 120000, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function syncEncrypt(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: b64u(iv), ct: b64u(ct) };
}
async function syncDecrypt(key, pack) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ub64u(pack.iv) }, key, ub64u(pack.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

// Storage: extendsclass.com's free JSON-bin API — anonymous create/read/
// overwrite. The bin id is server-assigned; the payload stored in it is our
// encrypted {iv, ct} pack, so id secrecy isn't load-bearing for privacy.
const SYNC_BASE = "https://extendsclass.com/api/json-storage/bin";

// GET returns the bin's stored pack (or null if the bin is new/empty);
// PUT overwrites it. The ?nocache= param defeats read-side caching —
// sync correctness depends on always seeing the latest document.
async function syncFetch(method, roomId, body) {
  const url = method === "GET" ? `${SYNC_BASE}/${roomId}?nocache=${Date.now()}` : `${SYNC_BASE}/${roomId}`;
  const res = await fetch(viaProxy(url), {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error("sync-" + res.status);
  const text = await res.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/* ---------- snapshots & merging ---------- */
function syncLocalSnapshot() {
  const list = ensureProfiles();
  return {
    profiles: list.map(p => ({
      name: p.name, color: p.color, avatar: p.avatar, modified: p.modified || 0,
    })),
    data: Object.fromEntries(list.map(p => [
      p.name,
      {
        watching: JSON.parse(localStorage.getItem(`vk_watching::${p.id}`) || "{}"),
        reading: JSON.parse(localStorage.getItem(`mdx_reading::${p.id}`) || "{}"),
      },
    ])),
  };
}

// Newer entry wins, per title key. Entries without timestamps lose to any.
function mergeDated(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    if (!cur || (v && (v.updated || 0)) > (cur.updated || 0)) out[k] = v;
  }
  return out;
}

// Combine local + remote snapshots into one merged room document.
function syncMergeDocs(local, remote) {
  const list = ensureProfiles();
  let listChanged = false;
  for (const rp of remote.profiles || []) {
    if (!rp || !rp.name) continue;
    let lp = list.find(p => p.name === rp.name);
    if (!lp) {
      list.push({
        id: "p" + Date.now() + Math.random().toString(36).slice(2, 5),
        name: rp.name,
        color: rp.color || PROFILE_COLORS[0],
        ...(rp.avatar ? { avatar: rp.avatar } : {}),
        modified: rp.modified || Date.now(),
      });
      listChanged = true;
    } else if ((rp.modified || 0) > (lp.modified || 0)) {
      lp.color = rp.color || lp.color;
      if (rp.avatar) lp.avatar = rp.avatar;
      lp.modified = rp.modified || lp.modified;
      listChanged = true;
    }
  }
  if (listChanged) profileStore.list = list;

  const names = new Set([
    ...Object.keys(local.data || {}),
    ...Object.keys(remote.data || {}),
  ]);
  const data = {};
  for (const name of names) {
    const a = (local.data || {})[name] || {};
    const b = (remote.data || {})[name] || {};
    data[name] = {
      watching: mergeDated(a.watching, b.watching),
      reading: mergeDated(a.reading, b.reading),
    };
  }
  return {
    v: 1,
    devices: { [syncDeviceId()]: { name: syncDeviceName(), updated: Date.now() } },
    profiles: list.map(p => ({ name: p.name, color: p.color, avatar: p.avatar, modified: p.modified || 0 })),
    data,
  };
}

// Write the merged document's data back into this device's localStorage.
// Returns true if anything actually changed.
function syncApplyLocally(doc) {
  const list = ensureProfiles();
  let touched = false;
  for (const p of list) {
    const d = (doc.data || {})[p.name];
    if (!d) continue;
    for (const [base, incoming] of [["vk_watching", d.watching], ["mdx_reading", d.reading]]) {
      if (!incoming) continue;
      const key = `${base}::${p.id}`;
      const cur = JSON.parse(localStorage.getItem(key) || "{}");
      const merged = mergeDated(cur, incoming);
      if (JSON.stringify(merged) !== JSON.stringify(cur)) {
        localStorage.setItem(key, JSON.stringify(merged));
        touched = true;
      }
    }
  }
  if (touched) scheduleBackup();
  return touched;
}

/* ---------- sync cycle ---------- */
let syncBusy = false;
let syncError = "";

async function syncNow() {
  const room = syncStore.room;
  if (!room || syncBusy) return;
  syncBusy = true;
  try {
    const key = await syncKey(room.pass, room.blob);
    let remote = { profiles: [], data: {} };
    try {
      const pack = await syncFetch("GET", room.blob);
      if (pack && pack.ct) remote = await syncDecrypt(key, pack);
    } catch (e) {
      // a failed pull (network) shouldn't stop the push — but a DECRYPT
      // failure means the passphrase changed; report it
      if (String(e).includes("OperationError")) throw new Error("wrong passphrase");
    }
    const merged = syncMergeDocs(syncLocalSnapshot(), remote);
    const changed = syncApplyLocally(merged);
    await syncFetch("PUT", room.blob, await syncEncrypt(key, merged));
    syncError = "";
    syncStore.lastSync = Date.now();
    // if a remote device added watch/reading progress, refresh the open view
    if (changed && typeof switchView === "function" && typeof currentView !== "undefined" &&
        (currentView === "watching" || currentView === "manga")) switchView(currentView);
  } catch (e) {
    syncError = e.message || String(e);
  } finally {
    syncBusy = false;
    if (typeof renderSyncStatus === "function") renderSyncStatus();
  }
}

let syncPushTimer = null;
// Called from scheduleBackup — pushes a few seconds after any data change.
function scheduleSyncPush() {
  if (!syncStore.room) return;
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(syncNow, 8000);
}

/* ---------- room management ---------- */
async function createSyncRoom() {
  const pass = randomPassphrase();
  // bins get a server-assigned id — create a placeholder, then fill it
  const res = await fetch(viaProxy(SYNC_BASE), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ placeholder: true }),
  });
  if (!res.ok) throw new Error("sync-" + res.status);
  const blob = ((await res.text()).match(/"id":\s*"([^"]+)"/) || [])[1];
  if (!blob) throw new Error("no room id returned");
  const key = await syncKey(pass, blob);
  await syncFetch("PUT", blob, await syncEncrypt(key, syncMergeDocs(syncLocalSnapshot(), { profiles: [], data: {} })));
  syncStore.room = { blob, pass };
  syncStore.lastSync = Date.now();
  renderSyncStatus();
}

function randomPassphrase() {
  const words = ["harbor", "ember", "cactus", "raven", "pixel", "meadow", "quartz", "nomad",
    "fable", "onyx", "tulip", "comet", "maple", "zephyr", "orchid", "puzzle"];
  return Array.from({ length: 4 }, () => words[Math.floor(Math.random() * words.length)]).join("-");
}

async function joinSyncRoom(code) {
  const [blob, pass] = String(code || "").trim().split("|").map(s => s.trim());
  if (!blob || !pass) throw new Error("code looks wrong — expected <id>|<passphrase>");
  const key = await syncKey(pass, blob);
  const pack = await syncFetch("GET", blob);
  if (pack && pack.ct) await syncDecrypt(key, pack); // throws if passphrase is wrong
  syncStore.room = { blob, pass };
  await syncNow();
  if (typeof applyProfile === "function") applyProfile();
}

function leaveSyncRoom() {
  if (!confirm("Leave the sync room? Profiles already copied to this device stay, but future changes won't sync.")) return;
  localStorage.removeItem("fh_sync_room");
  localStorage.removeItem("fh_sync_last");
  syncError = "";
  renderSyncStatus();
}

/* ---------- settings UI ---------- */
function renderSyncStatus() {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  const room = syncStore.room;
  if (!room) {
    el.innerHTML = `<p class="hint">Not linked. Create a room and share the code with another device — profiles and continue-watching/reading merge by name.</p>`;
    document.getElementById("syncRoomActions").classList.remove("hidden");
    document.getElementById("syncLinkedActions").classList.add("hidden");
    return;
  }
  const ago = Math.round((Date.now() - syncStore.lastSync) / 1000);
  const when = syncStore.lastSync ? (ago < 60 ? "just now" : ago < 3600 ? Math.round(ago / 60) + " min ago" : Math.round(ago / 3600) + " h ago") : "never";
  el.innerHTML = `
    <p class="hint">Linked. <strong>${pEsc(room.pass)}</strong> is the passphrase — anyone with the room code can merge into it.</p>
    <p class="hint">Last sync: ${when}${syncBusy ? " · syncing…" : ""}${syncError ? ` · <span style="color:#ff5e7e">${pEsc(syncError)}</span>` : ""}</p>`;
  document.getElementById("syncRoomActions").classList.add("hidden");
  document.getElementById("syncLinkedActions").classList.remove("hidden");
}

function copySyncCode() {
  const room = syncStore.room;
  if (!room) return;
  navigator.clipboard.writeText(`${room.blob}|${room.pass}`).then(() => {
    const b = document.getElementById("syncCopyBtn");
    if (b) { b.textContent = "Copied!"; setTimeout(() => { b.textContent = "Copy Room Code"; }, 1500); }
  });
}

/* ---------- boot ---------- */
setInterval(syncNow, SYNC_POLL_MS);
