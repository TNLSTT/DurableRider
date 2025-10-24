import durable from './durable.js';
import colaCalories from './colaCalories.js';

const profiles = new Map([
  [durable.key, durable],
  [colaCalories.key, colaCalories],
]);

const DEFAULT_PROFILE = durable.key;

export function listProfiles() {
  return Array.from(profiles.values()).map((profile) => ({
    key: profile.key,
    label: profile.label,
    description: profile.description,
  }));
}

export function resolveProfileKey(input) {
  if (!input) {
    return DEFAULT_PROFILE;
  }
  const normalized = String(input).trim().toLowerCase();
  if (profiles.has(normalized)) {
    return normalized;
  }

  // support using label names in query params (loosely)
  const byLabel = Array.from(profiles.values()).find((profile) => profile.label.toLowerCase() === normalized);
  if (byLabel) {
    return byLabel.key;
  }

  return DEFAULT_PROFILE;
}

export function isValidProfileKey(key) {
  if (!key) {
    return false;
  }
  const normalized = String(key).trim().toLowerCase();
  return profiles.has(normalized);
}

export function getRenderer(key) {
  const normalized = resolveProfileKey(key);
  return profiles.get(normalized) ?? profiles.get(DEFAULT_PROFILE);
}

export function getAllMarkers() {
  return Array.from(
    new Set(
      Array.from(profiles.values())
        .map((profile) => profile.marker)
        .filter(Boolean),
    ),
  );
}

export { DEFAULT_PROFILE };
