import {
  DEFAULT_VIDEO,
  HEARTBEAT_INTERVAL,
  MAX_SEARCH_RESULTS,
  PRESENCE_TTL,
  SEARCH_DEBOUNCE_MS,
  getNtfyConfig,
  getSearchEndpoints,
  getStorageKeys,
  resolveModeratorSession,
  verifyModeratorSecret,
} from "./config.js";

const { topic: NTFY_TOPIC, baseUrl: NTFY_BASE } = getNtfyConfig();
const {
  currentVideo: STORAGE_KEY,
  queue: QUEUE_STORAGE_KEY,
  volume: VOLUME_STORAGE_KEY,
  displayName: NAME_STORAGE_KEY,
  moderator: MODERATOR_STORAGE_KEY,
} = getStorageKeys();

const SEARCH_ENDPOINTS = getSearchEndpoints();
const CLIENT_ID = window.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

const COMMAND_MIN_INTERVAL = 1200;
const COMMAND_MAX_RETRIES = 2;
const COMMAND_RETRY_BASE_DELAY = 1500;

const form = document.getElementById("control-form");
const status = document.getElementById("status");
const videoInput = document.getElementById("video-input");
const skipButton = document.getElementById("skip-button");
const queueList = document.getElementById("queue-list");
const queueEmptyState = document.getElementById("queue-empty");
const nowPlayingLabel = document.getElementById("now-playing-label");
const volumeSlider = document.getElementById("volume-slider");
const playbackTimer = document.getElementById("playback-timer");
const listenersList = document.getElementById("listeners-list");
const listenersEmptyState = document.getElementById("listeners-empty");
const searchInput = document.getElementById("search-input");
const searchResultsList = document.getElementById("search-results");
const searchStatus = document.getElementById("search-status");
const searchEmptyState = document.getElementById("search-empty");
const displayNameForm = document.getElementById("display-name-form");
const displayNameInput = document.getElementById("display-name-input");
const displayNameStatus = document.getElementById("display-name-status");
const moderatorHandleInput = document.getElementById("moderator-handle");
const moderatorKeyInput = document.getElementById("moderator-key");
const moderatorStatus = document.getElementById("moderator-status");
const moderatorSignInButton = document.getElementById("moderator-sign-in");
const moderatorSignOutButton = document.getElementById("moderator-sign-out");

let player;
let playerReadyResolve;
const playerReady = new Promise((resolve) => (playerReadyResolve = resolve));
let hasModeratorAccess = false;
let activeModeratorId = null;
let activeModeratorLabel = null;

const MAX_DISPLAY_NAME_LENGTH = 40;
const DEFAULT_DISPLAY_NAME = "Listener";

const metadataCache = new Map();
const listeners = new Map();
const moderatorClaims = new Map();
let displayName = loadDisplayName();
let searchDebounceId = null;
let searchAbortController = null;
let searchRequestToken = 0;
let commandQueue = Promise.resolve();
let lastCommandSentAt = 0;
let playbackTimerIntervalId = null;

function parseVideoId(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function parseDurationString(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parts = value
    .split(":")
    .map((segment) => Number.parseInt(segment, 10))
    .filter((num) => Number.isFinite(num) && num >= 0);
  if (parts.length === 0) {
    return null;
  }
  let seconds = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const value = parts[parts.length - 1 - i];
    seconds += value * Math.pow(60, i);
  }
  return seconds;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function recordMetadata(videoId, partial = {}) {
  if (!videoId) return;
  const existing = metadataCache.get(videoId) || {};
  const normalized = {
    title: partial.title ?? existing.title ?? null,
    author: partial.author ?? existing.author ?? null,
    duration:
      Number.isFinite(partial.duration) && partial.duration > 0
        ? partial.duration
        : Number.isFinite(existing.duration) && existing.duration > 0
        ? existing.duration
        : null,
    thumbnail: partial.thumbnail ?? existing.thumbnail ?? null,
  };
  metadataCache.set(videoId, normalized);
}

function normalizeMetadataPayload(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const normalized = {};
  if (typeof raw.title === "string" && raw.title.trim()) {
    normalized.title = raw.title.trim();
  }
  if (typeof raw.author === "string" && raw.author.trim()) {
    normalized.author = raw.author.trim();
  }
  const durationValue = Number.isFinite(raw.duration)
    ? raw.duration
    : Number.isFinite(Number.parseFloat(raw.duration))
    ? Number.parseFloat(raw.duration)
    : null;
  if (Number.isFinite(durationValue) && durationValue > 0) {
    normalized.duration = Math.round(durationValue);
  }
  if (typeof raw.thumbnail === "string" && raw.thumbnail.trim()) {
    normalized.thumbnail = raw.thumbnail.trim();
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function loadStoredQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries = [];
    for (const entry of parsed) {
      let videoId = null;
      let addedBy = null;
      if (entry && typeof entry === "object") {
        videoId = parseVideoId(entry.id ?? entry.videoId ?? entry.videoID ?? entry.video ?? "");
        const rawAddedBy =
          typeof entry.addedBy === "string"
            ? entry.addedBy
            : typeof entry.queuedBy === "string"
            ? entry.queuedBy
            : "";
        const sanitizedAddedBy = sanitizeDisplayName(rawAddedBy);
        if (sanitizedAddedBy) {
          addedBy = sanitizedAddedBy;
        }
      } else {
        videoId = parseVideoId(typeof entry === "string" ? entry : String(entry ?? ""));
      }
      if (videoId) {
        entries.push({ id: videoId, addedBy });
      }
    }
    return entries;
  } catch (error) {
    console.warn("Unable to restore queue from storage", error);
    return [];
  }
}

let queue = loadStoredQueue();
let currentVideoId = parseVideoId(localStorage.getItem(STORAGE_KEY)) || null;

function setStatus(message, success = false) {
  if (!status) return;
  status.textContent = message;
  status.style.color = success ? "#8ef6b4" : "#ff89a7";
}

function setDisplayNameStatus(message, success = false) {
  if (!displayNameStatus) return;
  displayNameStatus.textContent = message || "";
  if (!message) {
    displayNameStatus.removeAttribute("data-success");
    return;
  }
  if (success) {
    displayNameStatus.setAttribute("data-success", "true");
  } else {
    displayNameStatus.removeAttribute("data-success");
  }
}

resetSearchUI();
updatePlaybackTimer();

function setSearchStatus(message, { success = false, isError = false } = {}) {
  if (!searchStatus) return;
  searchStatus.textContent = message || "";
  if (!message) {
    searchStatus.style.color = "#d5d9ff";
    return;
  }
  if (success) {
    searchStatus.style.color = "#8ef6b4";
  } else if (isError) {
    searchStatus.style.color = "#ff89a7";
  } else {
    searchStatus.style.color = "#d5d9ff";
  }
}

function resetSearchUI() {
  if (searchResultsList) {
    searchResultsList.innerHTML = "";
    searchResultsList.hidden = true;
  }
  if (searchEmptyState) {
    searchEmptyState.textContent = "Start typing to discover suggestions.";
    searchEmptyState.hidden = false;
  }
  setSearchStatus("");
}

function showSearchEmpty(message) {
  if (searchEmptyState) {
    if (message) {
      searchEmptyState.textContent = message;
      searchEmptyState.hidden = false;
    } else {
      searchEmptyState.hidden = true;
    }
  }
  if (searchResultsList) {
    searchResultsList.hidden = true;
  }
}

function cancelPendingSearch() {
  if (searchDebounceId) {
    window.clearTimeout(searchDebounceId);
    searchDebounceId = null;
  }
  if (searchAbortController) {
    searchAbortController.abort();
    searchAbortController = null;
  }
}

function renderSearchResults(results) {
  if (!searchResultsList) {
    return;
  }
  searchResultsList.innerHTML = "";
  if (!Array.isArray(results) || results.length === 0) {
    showSearchEmpty("No matches found. Try another search term.");
    return;
  }
  searchResultsList.hidden = false;
  if (searchEmptyState) {
    searchEmptyState.hidden = true;
  }
  for (const result of results) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result-button";
    button.dataset.videoId = result.videoId;
    if (result.title) {
      button.dataset.title = result.title;
    }
    if (result.author) {
      button.dataset.author = result.author;
    }
    if (Number.isFinite(result.duration)) {
      button.dataset.duration = String(result.duration);
    }
    if (result.thumbnail) {
      button.dataset.thumbnail = result.thumbnail;
    }

    const thumb = document.createElement("img");
    thumb.className = "search-result-thumb";
    thumb.loading = "lazy";
    const fallbackThumb = `https://i.ytimg.com/vi/${result.videoId}/hqdefault.jpg`;
    thumb.src = result.thumbnail || fallbackThumb;
    thumb.alt = result.title ? `Thumbnail for ${result.title}` : "Video thumbnail";

    const body = document.createElement("div");
    body.className = "search-result-body";

    const title = document.createElement("div");
    title.className = "search-result-title";
    title.textContent = result.title || `https://youtu.be/${result.videoId}`;

    const meta = document.createElement("div");
    meta.className = "search-result-meta";
    const metaParts = [];
    if (result.author) {
      metaParts.push(result.author);
    }
    const durationText = result.duration ? formatDuration(result.duration) : null;
    if (durationText) {
      metaParts.push(durationText);
    }
    metaParts.push(`https://youtu.be/${result.videoId}`);
    meta.textContent = metaParts.join(" · ");

    body.append(title, meta);
    button.append(thumb, body);
    item.append(button);
    searchResultsList.append(item);
  }
}

async function performSearch(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    resetSearchUI();
    return;
  }
  if (trimmed.length < 2) {
    cancelPendingSearch();
    setSearchStatus("");
    showSearchEmpty("Type at least two characters to search YouTube.");
    return;
  }

  cancelPendingSearch();
  searchRequestToken += 1;
  const currentToken = searchRequestToken;
  setSearchStatus("Searching…");
  showSearchEmpty("Looking up videos…");

  for (const buildUrl of SEARCH_ENDPOINTS) {
    const endpoint = buildUrl(trimmed);
    try {
      const controller = new AbortController();
      searchAbortController = controller;
      const response = await fetch(endpoint, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Search failed (${response.status})`);
      }
      const payload = await response.json();
      if (currentToken !== searchRequestToken) {
        return;
      }
      const items = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
        ? payload.items
        : [];
      const normalized = [];
      for (const entry of items) {
        const rawUrl =
          typeof entry?.url === "string"
            ? entry.url
            : typeof entry?.id === "string"
            ? entry.id
            : typeof entry?.videoId === "string"
            ? entry.videoId
            : "";
        const videoId = parseVideoId(rawUrl);
        if (!videoId) {
          continue;
        }
        const type = String(entry?.type || entry?.itemType || entry?.kind || "video").toLowerCase();
        if (type && !type.includes("video")) {
          continue;
        }
        const title = typeof entry?.title === "string" ? entry.title : null;
        const author =
          typeof entry?.uploader === "string"
            ? entry.uploader
            : typeof entry?.uploaderName === "string"
            ? entry.uploaderName
            : typeof entry?.author === "string"
            ? entry.author
            : typeof entry?.channel === "string"
            ? entry.channel
            : null;
        const durationSeconds = Number.isFinite(entry?.duration)
          ? entry.duration
          : parseDurationString(entry?.durationString || entry?.duration_text || "");
        let thumbnail = null;
        if (typeof entry?.thumbnail === "string") {
          thumbnail = entry.thumbnail;
        } else if (Array.isArray(entry?.thumbnails) && entry.thumbnails.length > 0) {
          const firstThumb = entry.thumbnails[0];
          if (firstThumb) {
            thumbnail = typeof firstThumb === "string" ? firstThumb : firstThumb.url || null;
          }
        }
        normalized.push({
          videoId,
          title,
          author,
          duration: durationSeconds || null,
          thumbnail,
        });
        if (normalized.length >= MAX_SEARCH_RESULTS) {
          break;
        }
      }
      if (normalized.length > 0 || buildUrl === SEARCH_ENDPOINTS[SEARCH_ENDPOINTS.length - 1]) {
        renderSearchResults(normalized);
        if (normalized.length > 0) {
          setSearchStatus("", { success: false });
        } else {
          setSearchStatus("No videos found for that search.");
        }
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
      console.warn("Search request failed", error);
      // Try the next endpoint in the list.
      continue;
    } finally {
      if (searchAbortController) {
        searchAbortController = null;
      }
    }
  }
  setSearchStatus("Unable to reach the search service.", { isError: true });
  showSearchEmpty("Search is unavailable right now. Try again in a bit.");
}

function setModeratorStatus(message, success = false) {
  if (!moderatorStatus) return;
  moderatorStatus.textContent = message;
  if (success) {
    moderatorStatus.dataset.success = "true";
  } else {
    moderatorStatus.removeAttribute("data-success");
  }
}

function updateModeratorUI() {
  const disabled = hasModeratorAccess;
  if (moderatorHandleInput) {
    moderatorHandleInput.disabled = disabled;
    if (!disabled && !activeModeratorId) {
      moderatorHandleInput.value = "";
    }
  }
  if (moderatorKeyInput) {
    moderatorKeyInput.disabled = disabled;
  }
  if (moderatorSignInButton) {
    moderatorSignInButton.disabled = disabled;
  }
  if (moderatorSignOutButton) {
    moderatorSignOutButton.disabled = !disabled;
  }
}

function saveModeratorSession(id, storedHash) {
  if (!id || !storedHash) {
    return;
  }
  try {
    localStorage.setItem(
      MODERATOR_STORAGE_KEY,
      JSON.stringify({ id, storedHash, timestamp: Date.now() })
    );
  } catch (error) {
    console.warn("Unable to persist moderator session", error);
  }
}

function clearModeratorSession() {
  try {
    localStorage.removeItem(MODERATOR_STORAGE_KEY);
  } catch (error) {
    console.warn("Unable to clear moderator session", error);
  }
}

function grantModeratorAccess(moderator, storedHash, { silent = false } = {}) {
  if (!moderator) {
    return;
  }
  hasModeratorAccess = true;
  activeModeratorId = moderator.id;
  activeModeratorLabel = moderator.label ?? moderator.id;
  if (moderatorHandleInput) {
    moderatorHandleInput.value = activeModeratorLabel;
  }
  updateModeratorUI();
  updateModeratorControls();
  renderQueue();
  if (!silent) {
    setModeratorStatus(`Moderator tools unlocked for ${moderator.label}.`, true);
    setStatus(`Moderator tools unlocked for ${moderator.label}.`, true);
  }
  if (storedHash) {
    saveModeratorSession(moderator.id, storedHash);
  }
  recordPresence(CLIENT_ID, getSelfPresenceDetails({ includeTimestamp: true }));
  broadcastPresence("heartbeat");
}

function revokeModeratorAccess({ silent = false } = {}) {
  hasModeratorAccess = false;
  activeModeratorId = null;
  activeModeratorLabel = null;
  updateModeratorUI();
  updateModeratorControls();
  renderQueue();
  clearModeratorSession();
  recordPresence(CLIENT_ID, getSelfPresenceDetails({ includeTimestamp: true }));
  broadcastPresence("heartbeat");
  if (!silent) {
    setModeratorStatus("Moderator tools locked.");
    setStatus("Moderator tools locked.");
  }
}

function tryRestoreModeratorSession() {
  let parsed = null;
  try {
    const raw = localStorage.getItem(MODERATOR_STORAGE_KEY);
    if (!raw) {
      return;
    }
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn("Unable to read stored moderator session", error);
  }
  if (!parsed || typeof parsed !== "object") {
    return;
  }
  const { id, storedHash } = parsed;
  if (!id || !storedHash) {
    return;
  }
  const resolved = resolveModeratorSession(id, storedHash);
  if (!resolved) {
    clearModeratorSession();
    return;
  }
  grantModeratorAccess(resolved.moderator, resolved.storedHash, { silent: true });
  setModeratorStatus(`Restored moderator access for ${resolved.moderator.label}.`, true);
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function performCommandSend(payload, options = {}, attempt = 0) {
  const { useBeacon = false } = options;
  const enriched = { ...payload, clientId: CLIENT_ID, timestamp: Date.now() };
  const body = JSON.stringify(enriched);
  const url = `${NTFY_BASE}/${encodeURIComponent(NTFY_TOPIC)}`;

  if (useBeacon && typeof navigator?.sendBeacon === "function") {
    try {
      const ok = navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }));
      if (ok) {
        return;
      }
    } catch (error) {
      console.warn("sendBeacon failed, falling back to fetch", error);
    }
  }

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-Title": "Plug.DJ But Bad update",
      },
      body,
    });
  } catch (error) {
    const networkError = new Error("Unable to reach the sync service.");
    networkError.cause = error;
    throw networkError;
  }

  if (response.ok) {
    return;
  }

  if (response.status === 429 && attempt < COMMAND_MAX_RETRIES) {
    const retryAfterHeader = response.headers.get("Retry-After");
    let retryDelay = Number.parseInt(retryAfterHeader || "", 10);
    if (Number.isFinite(retryDelay) && retryDelay > 0) {
      retryDelay *= 1000;
    } else {
      retryDelay = COMMAND_RETRY_BASE_DELAY * Math.pow(2, attempt);
    }
    await wait(retryDelay);
    return performCommandSend(payload, options, attempt + 1);
  }

  const error = new Error(`ntfy update failed (${response.status})`);
  error.status = response.status;
  throw error;
}

async function scheduleCommandSend(payload, options = {}) {
  const now = Date.now();
  const waitTime = lastCommandSentAt + COMMAND_MIN_INTERVAL - now;
  if (waitTime > 0) {
    await wait(waitTime);
  }
  try {
    await performCommandSend(payload, options);
  } finally {
    lastCommandSentAt = Date.now();
  }
}

async function sendCommand(payload, options = {}) {
  const { useBeacon = false } = options;
  if (useBeacon) {
    return performCommandSend(payload, options);
  }

  const queued = commandQueue.then(
    () => scheduleCommandSend(payload, options),
    () => scheduleCommandSend(payload, options)
  );

  commandQueue = queued.catch(() => {});
  return queued;
}

function describeSyncError(error, fallbackMessage) {
  if (error && typeof error === "object" && error.status === 429) {
    return "We're sending updates too quickly. Try again in a few seconds.";
  }
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message;
  }
  return fallbackMessage;
}

function persistQueue() {
  try {
    const serialized = queue
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const videoId = parseVideoId(entry.id ?? "");
        if (!videoId) {
          return null;
        }
        const savedName = sanitizeDisplayName(entry.addedBy);
        return {
          id: videoId,
          addedBy: savedName || null,
        };
      })
      .filter(Boolean);
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(serialized));
  } catch (error) {
    console.warn("Unable to persist queue", error);
  }
}

function persistCurrentVideo(videoId = currentVideoId) {
  try {
    if (videoId) {
      localStorage.setItem(STORAGE_KEY, videoId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (error) {
    console.warn("Unable to store current video", error);
  }
}

function persistDisplayName(name) {
  try {
    if (name) {
      localStorage.setItem(NAME_STORAGE_KEY, name);
    } else {
      localStorage.removeItem(NAME_STORAGE_KEY);
    }
  } catch (error) {
    console.warn("Unable to store display name", error);
  }
}

function generateDisplayName() {
  const adjectives = [
    "Neon",
    "Velvet",
    "Chill",
    "Cosmic",
    "Lunar",
    "Echo",
    "Retro",
    "Midnight",
  ];
  const nouns = ["Beat", "Wave", "Pulse", "Nova", "Groove", "Spark", "Rhythm", "Muse"];
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)] ?? "Neon";
  const noun = nouns[Math.floor(Math.random() * nouns.length)] ?? "Beat";
  const suffix = CLIENT_ID.slice(0, 4).toUpperCase();
  return `${adjective} ${noun} #${suffix}`;
}

function sanitizeDisplayName(value) {
  if (typeof value !== "string") {
    return "";
  }
  const normalizedWhitespace = value.replace(/\s+/g, " ").trim();
  if (!normalizedWhitespace) {
    return "";
  }
  const characters = Array.from(normalizedWhitespace);
  if (characters.length > MAX_DISPLAY_NAME_LENGTH) {
    return characters.slice(0, MAX_DISPLAY_NAME_LENGTH).join("");
  }
  return normalizedWhitespace;
}

function loadDisplayName() {
  try {
    const stored = localStorage.getItem(NAME_STORAGE_KEY);
    const sanitizedStored = sanitizeDisplayName(stored);
    if (sanitizedStored) {
      if (stored !== sanitizedStored) {
        persistDisplayName(sanitizedStored);
      }
      return sanitizedStored;
    }
  } catch (error) {
    console.warn("Unable to read saved display name", error);
  }
  const generated = sanitizeDisplayName(generateDisplayName()) || DEFAULT_DISPLAY_NAME;
  try {
    persistDisplayName(generated);
  } catch (error) {
    console.warn("Unable to persist generated display name", error);
  }
  return generated;
}

function normalizeListenerName(name, clientId) {
  const sanitized = sanitizeDisplayName(name);
  if (sanitized) {
    return sanitized;
  }
  const suffix = (clientId || "").slice(-4).toUpperCase();
  return suffix ? `Listener #${suffix}` : DEFAULT_DISPLAY_NAME;
}

function releaseModeratorClaim(moderatorId, clientId = null) {
  if (!moderatorId) {
    return;
  }
  const claim = moderatorClaims.get(moderatorId);
  if (!claim) {
    return;
  }
  if (clientId && claim.clientId !== clientId) {
    return;
  }
  moderatorClaims.delete(moderatorId);
}

function releaseModeratorClaimsForClient(clientId) {
  if (!clientId) {
    return;
  }
  for (const [id, claim] of moderatorClaims) {
    if (claim.clientId === clientId) {
      moderatorClaims.delete(id);
    }
  }
}

function recordPresence(clientId, info = {}) {
  if (!clientId) return;
  const normalizedName = normalizeListenerName(info.name, clientId);
  const timestamp = typeof info.timestamp === "number" ? info.timestamp : Date.now();
  const isSelf = clientId === CLIENT_ID;
  const rawModeratorId = typeof info.moderatorId === "string" ? info.moderatorId.trim() : "";
  const normalizedModeratorId = rawModeratorId ? rawModeratorId.toLowerCase() : "";
  const moderatorId = normalizedModeratorId || null;
  const moderatorLabelRaw = typeof info.moderatorLabel === "string" ? info.moderatorLabel.trim() : "";
  const fallbackLabel = rawModeratorId || normalizedModeratorId || null;
  const moderatorLabel = moderatorLabelRaw || fallbackLabel;
  const existing = listeners.get(clientId);
  if (existing?.moderatorId && existing.moderatorId !== moderatorId) {
    releaseModeratorClaim(existing.moderatorId, clientId);
  }
  if (!moderatorId) {
    releaseModeratorClaimsForClient(clientId);
  }
  listeners.set(clientId, {
    name: normalizedName,
    lastSeen: timestamp,
    isSelf,
    moderatorId,
    moderatorLabel,
  });
  if (moderatorId) {
    moderatorClaims.set(moderatorId, {
      clientId,
      label: moderatorLabel || fallbackLabel || moderatorId,
    });
  }
  updateListenersUI();
}

function removeListener(clientId) {
  if (!clientId) return;
  releaseModeratorClaimsForClient(clientId);
  listeners.delete(clientId);
  updateListenersUI();
}

function pruneStaleListeners() {
  const now = Date.now();
  for (const [id, info] of listeners) {
    if (now - info.lastSeen > PRESENCE_TTL) {
      releaseModeratorClaimsForClient(id);
      listeners.delete(id);
    }
  }
}

function updateListenersUI() {
  if (!listenersList || !listenersEmptyState) {
    return;
  }
  pruneStaleListeners();
  const entries = Array.from(listeners.values());
  listenersList.innerHTML = "";
  if (entries.length === 0) {
    listenersEmptyState.style.display = "block";
    return;
  }
  listenersEmptyState.style.display = "none";
  entries.sort((a, b) => {
    if (a.isSelf && !b.isSelf) return -1;
    if (!a.isSelf && b.isSelf) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const entry of entries) {
    const item = document.createElement("li");
    const nameEl = document.createElement("strong");
    nameEl.textContent = entry.name;
    item.appendChild(nameEl);
    const tagContainer = document.createElement("div");
    tagContainer.className = "listener-tags";
    if (entry.moderatorId) {
      const moderatorBadge = document.createElement("span");
      moderatorBadge.className = "listener-moderator";
      moderatorBadge.textContent = entry.moderatorLabel
        ? `Moderator: ${entry.moderatorLabel}`
        : "Moderator";
      tagContainer.appendChild(moderatorBadge);
    }
    if (entry.isSelf) {
      const badge = document.createElement("span");
      badge.className = "listener-self";
      badge.textContent = "You";
      tagContainer.appendChild(badge);
    } else {
      const statusEl = document.createElement("span");
      statusEl.className = "listener-status";
      statusEl.textContent = "Live";
      tagContainer.appendChild(statusEl);
    }
    if (tagContainer.childElementCount > 0) {
      item.appendChild(tagContainer);
    }
    listenersList.appendChild(item);
  }
}

function getSelfPresenceDetails({ includeTimestamp = false } = {}) {
  const details = { name: displayName };
  if (includeTimestamp) {
    details.timestamp = Date.now();
  }
  if (hasModeratorAccess && activeModeratorId) {
    details.moderatorId = activeModeratorId;
    if (activeModeratorLabel) {
      details.moderatorLabel = activeModeratorLabel;
    }
  }
  return details;
}

async function broadcastPresence(type = "heartbeat") {
  try {
    const payload = { action: "presence", type, ...getSelfPresenceDetails() };
    await sendCommand(payload);
  } catch (error) {
    console.warn("Unable to broadcast presence", error);
  }
}

async function applyDisplayNameChange(nextName) {
  if (!nextName) {
    setDisplayNameStatus("Pick a name between 1 and 40 characters.");
    return;
  }
  if (nextName === displayName) {
    setDisplayNameStatus("You're already using that name.", true);
    return;
  }

  displayName = nextName;
  persistDisplayName(displayName);
  const details = getSelfPresenceDetails({ includeTimestamp: true });
  recordPresence(CLIENT_ID, details);

  try {
    await broadcastPresence("update");
    setDisplayNameStatus("Name updated!", true);
  } catch (error) {
    const message = describeSyncError(
      error,
      "Saved locally, but notifying everyone else failed. Try again shortly."
    );
    setDisplayNameStatus(message);
  }
}

let presenceInitialized = false;
let presenceIntervalId = null;

function startPresenceHeartbeat() {
  if (presenceInitialized) {
    return;
  }
  presenceInitialized = true;
  recordPresence(CLIENT_ID, getSelfPresenceDetails({ includeTimestamp: true }));
  broadcastPresence("join");
  presenceIntervalId = window.setInterval(() => {
    recordPresence(CLIENT_ID, getSelfPresenceDetails());
    broadcastPresence("heartbeat");
  }, HEARTBEAT_INTERVAL);
}

function updateModeratorControls() {
  if (skipButton) {
    if (hasModeratorAccess) {
      skipButton.removeAttribute("data-locked");
      skipButton.disabled = false;
    } else {
      skipButton.setAttribute("data-locked", "true");
      skipButton.disabled = true;
    }
  }
}

function updateNowPlayingLabel() {
  if (!nowPlayingLabel) return;
  if (!currentVideoId) {
    nowPlayingLabel.textContent = "Nothing playing right now. Add something to the queue!";
    return;
  }
  const metadata = metadataCache.get(currentVideoId);
  const urlText = `https://youtu.be/${currentVideoId}`;
  if (metadata?.title) {
    const extras = [];
    if (metadata.author) {
      extras.push(metadata.author);
    }
    const durationText = metadata.duration ? formatDuration(metadata.duration) : null;
    if (durationText) {
      extras.push(durationText);
    }
    const suffix = extras.length > 0 ? ` — ${extras.join(" · ")}` : "";
    nowPlayingLabel.textContent = `${metadata.title}${suffix}`;
    return;
  }
  nowPlayingLabel.textContent = urlText;
}

function renderQueue() {
  if (!queueList || !queueEmptyState) return;
  queueEmptyState.hidden = queue.length > 0;
  queueList.innerHTML = "";
  const canModerate = hasModeratorAccess;
  queue.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const videoId = parseVideoId(entry.id ?? "");
    if (!videoId) {
      return;
    }
    const addedBy = sanitizeDisplayName(entry.addedBy) || DEFAULT_DISPLAY_NAME;
    const item = document.createElement("li");
    item.className = "queue-item";

    const info = document.createElement("div");
    info.className = "queue-item-info";
    const metadata = metadataCache.get(videoId);
    const titleEl = document.createElement("div");
    titleEl.className = "queue-item-title";
    const urlText = `https://youtu.be/${videoId}`;
    titleEl.textContent = metadata?.title || urlText;
    const metaEl = document.createElement("div");
    metaEl.className = "queue-item-meta";
    const metaBits = [];
    const durationText = metadata?.duration ? formatDuration(metadata.duration) : null;
    metaBits.push(durationText ?? "--:--");
    metaBits.push(`Added by ${addedBy}`);
    if (metadata?.author) {
      metaBits.push(metadata.author);
    }
    metaBits.push(urlText);
    metaEl.textContent = metaBits.join(" · ");
    info.append(titleEl, metaEl);

    const actions = document.createElement("div");
    actions.className = "queue-actions";

    const upButton = document.createElement("button");
    upButton.type = "button";
    upButton.textContent = "Move up";
    upButton.dataset.action = "move-up";
    upButton.dataset.index = String(index);
    upButton.disabled = !canModerate || index === 0;
    if (!canModerate) {
      upButton.dataset.locked = "true";
    } else {
      upButton.removeAttribute("data-locked");
    }

    const downButton = document.createElement("button");
    downButton.type = "button";
    downButton.textContent = "Move down";
    downButton.dataset.action = "move-down";
    downButton.dataset.index = String(index);
    downButton.disabled = !canModerate || index === queue.length - 1;
    if (!canModerate) {
      downButton.dataset.locked = "true";
    } else {
      downButton.removeAttribute("data-locked");
    }

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.dataset.action = "remove";
    removeButton.dataset.index = String(index);
    removeButton.disabled = !canModerate;
    if (!canModerate) {
      removeButton.dataset.locked = "true";
    } else {
      removeButton.removeAttribute("data-locked");
    }

    actions.append(upButton, downButton, removeButton);
    item.append(info, actions);
    queueList.append(item);
  });
}

function updatePlaybackTimer() {
  if (!playbackTimer) {
    return;
  }
  if (!currentVideoId) {
    playbackTimer.textContent = "0:00 / 0:00";
    return;
  }
  if (!player || typeof player.getCurrentTime !== "function" || typeof player.getDuration !== "function") {
    playbackTimer.textContent = "0:00 / --:--";
    return;
  }
  let currentSeconds;
  let durationSeconds;
  try {
    currentSeconds = player.getCurrentTime();
    durationSeconds = player.getDuration();
  } catch (error) {
    playbackTimer.textContent = "0:00 / --:--";
    return;
  }
  const formattedCurrent = formatDuration(currentSeconds) ?? "0:00";
  const formattedDuration = formatDuration(durationSeconds) ?? "--:--";
  playbackTimer.textContent = `${formattedCurrent} / ${formattedDuration}`;
  if (currentVideoId && Number.isFinite(durationSeconds) && durationSeconds > 0) {
    const existingMetadata = metadataCache.get(currentVideoId);
    const storedDuration = existingMetadata?.duration;
    if (!Number.isFinite(storedDuration) || storedDuration <= 0) {
      recordMetadata(currentVideoId, { duration: Math.round(durationSeconds) });
      renderQueue();
      updateNowPlayingLabel();
    }
  }
}

function startPlaybackTimer() {
  if (!playbackTimer) {
    return;
  }
  updatePlaybackTimer();
  if (playbackTimerIntervalId !== null) {
    return;
  }
  playbackTimerIntervalId = window.setInterval(updatePlaybackTimer, 500);
}

async function preloadMetadata(videoId) {
  if (!videoId) {
    return null;
  }
  const existing = metadataCache.get(videoId);
  if (existing && existing.title) {
    return existing;
  }
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${videoId}`
    );
    if (!response.ok) {
      throw new Error(`oEmbed lookup failed (${response.status})`);
    }
    const data = await response.json();
    recordMetadata(videoId, {
      title: data?.title || null,
      author: data?.author_name || null,
    });
  } catch (error) {
    console.warn("Unable to fetch metadata", error);
    if (!metadataCache.has(videoId)) {
      recordMetadata(videoId, {});
    }
  }
  renderQueue();
  updateNowPlayingLabel();
  return metadataCache.get(videoId);
}

function startPlayback(videoId) {
  if (!videoId) return;
  currentVideoId = videoId;
  persistCurrentVideo();

  playerReady.then(() => {
    if (!player) {
      return;
    }
    player.loadVideoById({ videoId: currentVideoId });
    player.playVideo();
  });

  preloadMetadata(currentVideoId);
  updateNowPlayingLabel();
  updatePlaybackTimer();
}

async function enqueueVideo(videoId, { broadcast = false, metadata = null, addedBy = null } = {}) {
  if (!videoId) return;
  const normalizedMetadata = normalizeMetadataPayload(metadata);
  if (normalizedMetadata) {
    recordMetadata(videoId, normalizedMetadata);
  }
  const localDisplayName = sanitizeDisplayName(displayName) || DEFAULT_DISPLAY_NAME;
  let queueAddedBy = sanitizeDisplayName(addedBy);
  if (!queueAddedBy) {
    queueAddedBy = broadcast ? localDisplayName : DEFAULT_DISPLAY_NAME;
  }
  if (broadcast) {
    const payload = { action: "enqueue", videoId, addedBy: queueAddedBy };
    if (normalizedMetadata) {
      payload.metadata = normalizedMetadata;
    }
    await sendCommand(payload);
  }
  queue.push({ id: videoId, addedBy: queueAddedBy });
  persistQueue();
  renderQueue();
  if (!normalizedMetadata) {
    preloadMetadata(videoId);
  } else {
    updateNowPlayingLabel();
  }
  if (!currentVideoId) {
    await advanceQueue({ broadcast: false, reason: "auto" });
  }
}

async function removeFromQueue(index, { broadcast = false } = {}) {
  if (index < 0 || index >= queue.length) return;
  if (broadcast) {
    await sendCommand({ action: "remove", index });
  }
  queue.splice(index, 1);
  persistQueue();
  renderQueue();
}

async function moveInQueue(from, to, { broadcast = false } = {}) {
  if (from === to) return;
  if (from < 0 || from >= queue.length) return;
  if (to < 0 || to >= queue.length) return;
  if (broadcast) {
    await sendCommand({ action: "move", from, to });
  }
  const [entry] = queue.splice(from, 1);
  queue.splice(to, 0, entry);
  persistQueue();
  renderQueue();
}

async function advanceQueue({ broadcast = false, reason = "auto" } = {}) {
  if (queue.length === 0) {
    persistQueue();
    currentVideoId = null;
    persistCurrentVideo();
    updateNowPlayingLabel();
    updatePlaybackTimer();
    playerReady.then(() => {
      if (player) {
        player.stopVideo();
      }
    });
    renderQueue();
    if (broadcast) {
      await sendCommand({ action: "advance", reason });
    }
    return;
  }

  const nextEntry = queue.shift();
  persistQueue();
  renderQueue();

  const nextVideoId = nextEntry ? parseVideoId(nextEntry.id ?? "") : null;

  if (broadcast) {
    await sendCommand({ action: "advance", reason });
  }

  if (!nextVideoId) {
    currentVideoId = null;
    persistCurrentVideo();
    updateNowPlayingLabel();
    updatePlaybackTimer();
    playerReady.then(() => {
      if (player) {
        player.stopVideo();
      }
    });
    if (queue.length > 0) {
      await advanceQueue({ broadcast: false, reason });
    }
    return;
  }

  startPlayback(nextVideoId);
}

function ensureModeratorAccess({ focusKey = false } = {}) {
  if (hasModeratorAccess) {
    return true;
  }
  setModeratorStatus("Only signed-in moderators can do that.");
  setStatus("Only moderators can do that.");
  if (focusKey && moderatorKeyInput && !moderatorKeyInput.disabled) {
    moderatorKeyInput.focus();
  }
  return false;
}

async function processCommand(command) {
  if (!command || typeof command !== "object") return;
  if (command.clientId && command.clientId === CLIENT_ID) {
    return;
  }
  switch (command.action) {
    case "enqueue": {
      const videoId = parseVideoId(command.videoId);
      if (videoId) {
        const metadata = normalizeMetadataPayload(command.metadata);
        const addedBy = typeof command.addedBy === "string" ? command.addedBy : null;
        await enqueueVideo(videoId, { broadcast: false, metadata, addedBy });
        setStatus("A new song was added to the queue.", true);
      }
      break;
    }
    case "advance": {
      await advanceQueue({ broadcast: false, reason: command.reason });
      if (command.reason === "skip") {
        setStatus("Song skipped by a moderator.", true);
      } else {
        setStatus("Moving to the next song.", true);
      }
      break;
    }
    case "remove": {
      if (typeof command.index === "number") {
        await removeFromQueue(command.index, { broadcast: false });
        setStatus("A song was removed from the queue.", true);
      }
      break;
    }
    case "move": {
      if (typeof command.from === "number" && typeof command.to === "number") {
        await moveInQueue(command.from, command.to, { broadcast: false });
        setStatus("Queue order updated.", true);
      }
      break;
    }
    case "presence": {
      const fromClient = typeof command.clientId === "string" ? command.clientId : null;
      if (!fromClient) {
        break;
      }
      if (command.type === "leave") {
        removeListener(fromClient);
        break;
      }
      const name = typeof command.name === "string" ? command.name : "";
      const timestamp = typeof command.timestamp === "number" ? command.timestamp : Date.now();
      const moderatorId = typeof command.moderatorId === "string" ? command.moderatorId : "";
      const moderatorLabel = typeof command.moderatorLabel === "string" ? command.moderatorLabel : "";
      recordPresence(fromClient, { name, timestamp, moderatorId, moderatorLabel });
      break;
    }
    default:
      break;
  }
}

function subscribeToUpdates() {
  const streamUrl = `${NTFY_BASE}/${encodeURIComponent(NTFY_TOPIC)}/sse`;
  const source = new EventSource(streamUrl);

  source.addEventListener("open", () => {
    setStatus("Connected to the DJ broadcast channel.", true);
    startPresenceHeartbeat();
    broadcastPresence("heartbeat");
  });

  source.addEventListener("message", async (event) => {
    if (!event?.data) return;
    try {
      const payload = JSON.parse(event.data);
      const body = typeof payload?.message === "string" ? payload.message : "";
      if (!body) return;
      const command = JSON.parse(body);
      await processCommand(command);
    } catch (error) {
      console.warn("Failed to parse ntfy payload", error);
    }
  });

  source.addEventListener("error", () => {
    setStatus("Connection to the update channel dropped. Retrying…");
  });

  return source;
}

if (displayNameInput) {
  displayNameInput.value = displayName;
  displayNameInput.addEventListener("input", () => {
    setDisplayNameStatus("");
  });
}

displayNameForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!displayNameInput) {
    return;
  }
  const desiredName = sanitizeDisplayName(displayNameInput.value);
  displayNameInput.value = desiredName;
  if (!desiredName) {
    setDisplayNameStatus("Pick a name between 1 and 40 characters.");
    displayNameInput.focus();
    return;
  }
  await applyDisplayNameChange(desiredName);
  displayNameInput.value = displayName;
});

searchInput?.addEventListener("input", () => {
  if (!searchInput) {
    return;
  }
  if (searchDebounceId) {
    window.clearTimeout(searchDebounceId);
    searchDebounceId = null;
  }
  const query = searchInput.value || "";
  searchDebounceId = window.setTimeout(() => {
    searchDebounceId = null;
    performSearch(query);
  }, SEARCH_DEBOUNCE_MS);
});

searchResultsList?.addEventListener("click", async (event) => {
  const button = event.target.closest?.("button.search-result-button");
  if (!button || button.disabled) {
    return;
  }
  const videoId = parseVideoId(button.dataset.videoId);
  if (!videoId) {
    setSearchStatus("Couldn't figure out that video's link.", { isError: true });
    return;
  }
  const durationValue = Number.parseInt(button.dataset.duration || "", 10);
  const metadata = {
    title: button.dataset.title || null,
    author: button.dataset.author || null,
    duration: Number.isFinite(durationValue) ? durationValue : null,
    thumbnail: button.dataset.thumbnail || null,
  };
  button.disabled = true;
  await playerReady;
  try {
    await enqueueVideo(videoId, { broadcast: true, metadata, addedBy: displayName });
    setStatus("Added to the shared queue!", true);
    const title = button.dataset.title;
    if (title) {
      setSearchStatus(`Queued “${title}”.`, { success: true });
    } else {
      setSearchStatus("Queued that video!", { success: true });
    }
  } catch (error) {
    console.error(error);
    const message = describeSyncError(error, "Failed to add that video.");
    setSearchStatus(message, { isError: true });
  } finally {
    button.disabled = false;
  }
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const rawVideo = videoInput?.value || "";
  const videoId = parseVideoId(rawVideo);

  if (!videoId) {
    setStatus("Please enter a valid YouTube video link or ID.");
    return;
  }

  await playerReady;
  try {
    await enqueueVideo(videoId, { broadcast: true, addedBy: displayName });
    setStatus("Added to the shared queue!", true);
    if (videoInput) {
      videoInput.value = "";
    }
  } catch (error) {
    console.error(error);
    const message = describeSyncError(error, "Failed to update the queue.");
    setStatus(message);
  }
});

skipButton?.addEventListener("click", async () => {
  if (!ensureModeratorAccess({ focusKey: true })) {
    return;
  }
  await playerReady;
  try {
    await advanceQueue({ broadcast: true, reason: "skip" });
    if (queue.length > 0) {
      setStatus("Skipped to the next song.", true);
    } else {
      setStatus("Skipped the current song. Queue is now empty.", true);
    }
  } catch (error) {
    console.error(error);
    const message = describeSyncError(error, "Failed to skip the current song.");
    setStatus(message);
  }
});

queueList?.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest("button[data-action]");
  if (!button) return;
  if (button.disabled) {
    return;
  }
  const index = Number(button.dataset.index);
  if (!Number.isInteger(index)) return;
  if (!ensureModeratorAccess({ focusKey: true })) {
    return;
  }
  try {
    switch (button.dataset.action) {
      case "remove":
        await removeFromQueue(index, { broadcast: true });
        setStatus("Removed that song from the queue.", true);
        break;
      case "move-up":
        if (index === 0) return;
        await moveInQueue(index, index - 1, { broadcast: true });
        setStatus("Moved the song up in the queue.", true);
        break;
      case "move-down":
        if (index === queue.length - 1) return;
        await moveInQueue(index, index + 1, { broadcast: true });
        setStatus("Moved the song down in the queue.", true);
        break;
      default:
        break;
    }
  } catch (error) {
    console.error(error);
    const message = describeSyncError(error, "Failed to update the queue.");
    setStatus(message);
  }
});

moderatorSignInButton?.addEventListener("click", async () => {
  if (hasModeratorAccess) {
    setModeratorStatus("You're already signed in as a moderator.", true);
    return;
  }
  const typedHandle = moderatorHandleInput?.value || "";
  const trimmedHandle = typedHandle.trim();
  const moderatorId = trimmedHandle.toLowerCase();
  if (!moderatorId) {
    setModeratorStatus("Enter your moderator name before signing in.");
    return;
  }
  const existingClaim = moderatorClaims.get(moderatorId);
  if (existingClaim && existingClaim.clientId !== CLIENT_ID) {
    const inUseLabel = existingClaim.label || trimmedHandle || moderatorId;
    setModeratorStatus(`${inUseLabel} is already signed in right now.`);
    return;
  }
  const secret = moderatorKeyInput?.value || "";
  if (!secret.trim()) {
    setModeratorStatus("Enter your personal key.");
    if (moderatorKeyInput) {
      moderatorKeyInput.focus();
    }
    return;
  }
  try {
    const result = await verifyModeratorSecret(moderatorId, secret);
    if (!result.ok || !result.moderator || !result.storedHash) {
      setModeratorStatus("That key doesn't match this moderator.");
      return;
    }
    grantModeratorAccess(result.moderator, result.storedHash);
  } catch (error) {
    console.error("Moderator sign-in failed", error);
    setModeratorStatus("Couldn't verify that key. Try again.");
    return;
  } finally {
    if (moderatorKeyInput) {
      moderatorKeyInput.value = "";
    }
  }
});

moderatorSignOutButton?.addEventListener("click", () => {
  if (!hasModeratorAccess) {
    setModeratorStatus("You're not signed in as a moderator.");
    return;
  }
  revokeModeratorAccess();
  if (moderatorKeyInput) {
    moderatorKeyInput.value = "";
  }
});

window.onYouTubeIframeAPIReady = function () {
  const startingVideo = currentVideoId || DEFAULT_VIDEO;
  currentVideoId = startingVideo;
  persistCurrentVideo();
  updateNowPlayingLabel();
  preloadMetadata(startingVideo);
  player = new YT.Player("player", {
    videoId: startingVideo,
    playerVars: {
      autoplay: 1,
      controls: 0,
      modestbranding: 1,
      rel: 0,
      iv_load_policy: 3,
      disablekb: 1,
    },
    events: {
      onReady: () => {
        playerReadyResolve();
        subscribeToUpdates();
        syncVolumeControl();
        startPlaybackTimer();
      },
      onStateChange: (event) => {
        if (event.data === YT.PlayerState.PAUSED) {
          player.playVideo();
        }
        if (event.data === YT.PlayerState.ENDED) {
          advanceQueue();
        }
        syncVolumeControl();
        updatePlaybackTimer();
      },
    },
  });
};

function syncVolumeControl() {
  if (!player || !volumeSlider) return;
  const muted = player.isMuted();
  const volume = player.getVolume();
  const appliedVolume = muted ? 0 : volume;
  if (Number(volumeSlider.value) !== appliedVolume) {
    volumeSlider.value = String(appliedVolume);
  }
}

if (volumeSlider) {
  const storedVolumeRaw = localStorage.getItem(VOLUME_STORAGE_KEY);
  if (storedVolumeRaw !== null) {
    const storedVolume = Number(storedVolumeRaw);
    if (!Number.isNaN(storedVolume) && storedVolume >= 0 && storedVolume <= 100) {
      volumeSlider.value = String(storedVolume);
      playerReady.then(() => {
        player.setVolume(storedVolume);
        if (storedVolume === 0) {
          player.mute();
        } else {
          player.unMute();
        }
        syncVolumeControl();
      });
    }
  }

  volumeSlider.addEventListener("input", async (event) => {
    await playerReady;
    const slider = /** @type {HTMLInputElement} */ (event.currentTarget);
    const value = Number(slider.value);
    const clamped = Math.max(0, Math.min(100, value));
    player.setVolume(clamped);
    if (clamped === 0) {
      player.mute();
    } else {
      player.unMute();
    }
    syncVolumeControl();
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
    } catch (error) {
      console.warn("Unable to store volume preference", error);
    }
  });
}

updateModeratorUI();
setModeratorStatus("Moderator tools locked.");
tryRestoreModeratorSession();

startPresenceHeartbeat();
updateListenersUI();
window.setInterval(updateListenersUI, HEARTBEAT_INTERVAL);

window.addEventListener("beforeunload", () => {
  if (presenceIntervalId !== null) {
    clearInterval(presenceIntervalId);
    presenceIntervalId = null;
  }
  const payload = { action: "presence", type: "leave", ...getSelfPresenceDetails() };
  sendCommand(payload, { useBeacon: true }).catch(
    () => {}
  );
});

queue.forEach((videoId) => preloadMetadata(videoId));
if (currentVideoId) {
  preloadMetadata(currentVideoId);
}
renderQueue();
updateModeratorControls();
updateNowPlayingLabel();

const script = document.createElement("script");
script.src = "https://www.youtube.com/iframe_api";
script.async = true;
document.head.appendChild(script);
