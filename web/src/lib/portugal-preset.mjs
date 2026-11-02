// Client-safe Portugal discovery preset (Explore → Pesquisar Portugal).
// Filters come from portals.yml on the server; the UI only selects the preset.

export const PORTUGAL_PRESET = "portugal";

/** Stable source ids shown in progress / cards (matches scan-portugal.mjs). */
export const PORTUGAL_SOURCES = [
  "landingjobs",
  "okemprego",
  "arbeitnow",
  "remoteok",
  "remotive",
  "himalayas",
];

export const PORTUGAL_SOURCE_LABEL = {
  landingjobs: "Landing.jobs",
  okemprego: "OkEmprego",
  arbeitnow: "Arbeitnow",
  remoteok: "RemoteOK",
  remotive: "Remotive",
  himalayas: "Himalayas",
};

/** Body the Explore client POSTs for the Portugal preset. */
export function portugalRequest(raw = {}) {
  if (raw?.preset !== PORTUGAL_PRESET) throw new Error("Unknown Portugal preset.");
  return { preset: PORTUGAL_PRESET };
}
