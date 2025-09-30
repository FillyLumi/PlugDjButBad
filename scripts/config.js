const ntfyConfig = Object.freeze({
  topic: "plugdjbutbad-demo",
  baseUrl: "https://ntfy.sh",
});

const storageKeys = Object.freeze({
  currentVideo: "plugdjbutbad.currentVideo",
  currentVideoStartedAt: "plugdjbutbad.currentVideoStartedAt",
  queue: "plugdjbutbad.queue",
  volume: "plugdjbutbad.volume",
  displayName: "plugdjbutbad.displayName",
  moderator: "plugdjbutbad.moderator",
});

const DEFAULT_VIDEO = "5qap5aO4i9A";
const SEARCH_DEBOUNCE_MS = 350;
const MAX_SEARCH_RESULTS = 6;
const HEARTBEAT_INTERVAL = 15000;
const PRESENCE_TTL = 45000;

const searchEndpoints = [
  (query) =>
    `https://piped.video/api/v1/search?filter=videos&region=US&q=${encodeURIComponent(query)}`,
  (query) =>
    `https://piped.video/api/v1/search?filter=videos&region=GB&q=${encodeURIComponent(query)}`,
];

const moderatorRoster = [
  {
    id: "host",
    label: "Host DJ",
    secretHash: "b5e2caab6d7cae6d37c7edb8dc270678f5d6f0e601ea09eac8687f544bc7e4ca",
  },
  {
    id: "cohost",
    label: "Co-Host",
    secretHash: "6dc6a04104d3711637783908721c79a1d1826b974dd23797070ce839ed9a83b0",
  },
];

function clone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => clone(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, clone(val)])
    );
  }
  return value;
}

function listModerators() {
  return moderatorRoster.map(({ id, label }) => ({ id, label }));
}

function findModerator(id) {
  return moderatorRoster.find((entry) => entry.id === id) || null;
}

async function hashSecret(secret) {
  const trimmed = typeof secret === "string" ? secret.trim() : "";
  if (!trimmed) {
    throw new Error("Moderator key is required");
  }
  const crypto = globalThis.crypto?.subtle;
  if (!crypto) {
    throw new Error("Web Crypto API not available for hashing moderator keys.");
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(trimmed);
  const digest = await crypto.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyModeratorSecret(id, secret) {
  const moderator = findModerator(id);
  if (!moderator) {
    return { ok: false, moderator: null, storedHash: null };
  }
  const trimmed = typeof secret === "string" ? secret.trim() : "";
  if (!trimmed) {
    return { ok: false, moderator: null, storedHash: null };
  }
  const expectedRaw = String(moderator.secretHash || "");
  if (!expectedRaw) {
    return { ok: false, moderator: null, storedHash: null };
  }
  const expectedNormalized = expectedRaw.toLowerCase();
  const looksHashed = /^[a-f0-9]{64}$/.test(expectedNormalized);
  if (globalThis.crypto?.subtle) {
    try {
      const hashed = await hashSecret(trimmed);
      if (hashed === expectedNormalized) {
        return {
          ok: true,
          moderator: { id: moderator.id, label: moderator.label },
          storedHash: hashed,
        };
      }
    } catch (error) {
      console.warn("Unable to hash moderator secret", error);
    }
  }
  if (trimmed === expectedRaw) {
    if (globalThis.crypto?.subtle) {
      try {
        const hashed = await hashSecret(trimmed);
        return {
          ok: true,
          moderator: { id: moderator.id, label: moderator.label },
          storedHash: hashed,
        };
      } catch (error) {
        console.warn("Unable to hash moderator secret for storage", error);
      }
    }
    return {
      ok: true,
      moderator: { id: moderator.id, label: moderator.label },
      storedHash: looksHashed ? expectedNormalized : expectedRaw,
    };
  }
  if (!globalThis.crypto?.subtle && trimmed.toLowerCase() === expectedNormalized) {
    return {
      ok: true,
      moderator: { id: moderator.id, label: moderator.label },
      storedHash: looksHashed ? expectedNormalized : expectedRaw,
    };
  }
  return { ok: false, moderator: null, storedHash: null };
}

function resolveModeratorSession(id, storedHash) {
  const moderator = findModerator(id);
  if (!moderator || !storedHash) {
    return null;
  }
  const expectedRaw = String(moderator.secretHash || "");
  if (!expectedRaw) {
    return null;
  }
  const expectedNormalized = expectedRaw.toLowerCase();
  const looksHashed = /^[a-f0-9]{64}$/.test(expectedNormalized);
  const matchesHashed = storedHash === expectedNormalized;
  const matchesRaw = !looksHashed && storedHash === expectedRaw;
  if (!matchesHashed && !matchesRaw) {
    return null;
  }
  return {
    moderator: { id: moderator.id, label: moderator.label },
    storedHash: looksHashed ? expectedNormalized : expectedRaw,
  };
}

export function getNtfyConfig() {
  return clone(ntfyConfig);
}

export function getSearchEndpoints() {
  return searchEndpoints.slice();
}

export function getStorageKeys() {
  return clone(storageKeys);
}

export {
  DEFAULT_VIDEO,
  HEARTBEAT_INTERVAL,
  MAX_SEARCH_RESULTS,
  PRESENCE_TTL,
  SEARCH_DEBOUNCE_MS,
  listModerators,
  resolveModeratorSession,
  verifyModeratorSecret,
};
