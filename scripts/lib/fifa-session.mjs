import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium, request } from "playwright";

const DEFAULT_TIMEOUT_MS = 45_000;

export const FIFA_CONFIG = {
  teamUrl: "https://play.fifa.com/fantasy/team",
  storageStatePath: resolve(".secrets/fifa-storage-state.json"),
  profileDir: resolve(".secrets/fifa-browser-profile"),
  discoveryPath: resolve("data/fifa-api-discovery.json"),
  playersPath: resolve("data/fantasy-players.json"),
  squadsPath: resolve("data/fantasy-squads.json"),
  roundsPath: resolve("data/fantasy-rounds.json"),
  rawStatePath: resolve("data/live-fifa-team-raw.json"),
  normalizedStatePath: resolve("data/live-fifa-team.json")
};

export async function ensureParentDir(path) {
  await mkdir(dirname(path), { recursive: true });
}

export async function writeJson(path, value) {
  await ensureParentDir(path);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function pathExists(path) {
  try {
    await readFile(path, "utf8");
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function launchFifaContext({ headless = false, storageState = true } = {}) {
  const contextOptions = {
    headless,
    viewport: { width: 1440, height: 1100 }
  };

  if (storageState && await pathExists(FIFA_CONFIG.storageStatePath)) {
    contextOptions.storageState = FIFA_CONFIG.storageStatePath;
  }

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext(contextOptions);
  context.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
  const page = await context.newPage();
  return { browser, context, page };
}

export async function createApiContext() {
  const options = await pathExists(FIFA_CONFIG.storageStatePath)
    ? { storageState: FIFA_CONFIG.storageStatePath }
    : {};
  return request.newContext(options);
}

export function isJsonResponse(response) {
  const type = response.headers()["content-type"] ?? "";
  return type.includes("application/json") || type.includes("+json");
}

export function summarizeHeaders(headers) {
  const keep = [
    "accept",
    "content-type",
    "referer",
    "origin",
    "x-requested-with",
    "x-csrf-token",
    "x-xsrf-token",
    "authorization"
  ];
  return Object.fromEntries(
    keep
      .filter((key) => headers[key])
      .map((key) => [key, headers[key]])
  );
}

export async function fetchPublicFantasyData() {
  const endpoints = [
    { url: "https://play.fifa.com/json/fantasy/players.json", path: FIFA_CONFIG.playersPath },
    { url: "https://play.fifa.com/json/fantasy/squads.json", path: FIFA_CONFIG.squadsPath },
    { url: "https://play.fifa.com/json/fantasy/rounds.json", path: FIFA_CONFIG.roundsPath }
  ];

  const values = {};
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch FIFA public data: ${endpoint.url} (${response.status})`);
    }
    const json = await response.json();
    await writeJson(endpoint.path, json);
    values[endpoint.path] = json;
  }

  return {
    players: values[FIFA_CONFIG.playersPath],
    squads: values[FIFA_CONFIG.squadsPath],
    rounds: values[FIFA_CONFIG.roundsPath]
  };
}

export function looksRelevantTeamPayload(payload) {
  return deepFind(payload, (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const keys = new Set(Object.keys(value).map((key) => key.toLowerCase()));
    const squadSignals = ["squad", "lineup", "players", "bench"];
    const scoreSignals = ["points", "totalpoints", "captain"];
    return squadSignals.some((key) => keys.has(key)) && scoreSignals.some((key) => keys.has(key));
  }).length > 0;
}

export function deepFind(value, predicate, path = "$", results = []) {
  if (predicate(value, path)) {
    results.push({ path, value });
  }
  if (!value || typeof value !== "object") return results;
  if (Array.isArray(value)) {
    value.forEach((item, index) => deepFind(item, predicate, `${path}[${index}]`, results));
    return results;
  }
  for (const [key, child] of Object.entries(value)) {
    deepFind(child, predicate, `${path}.${key}`, results);
  }
  return results;
}

function normalizeStatusFromText(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "unknown";
  if (["played", "completed", "finished", "final"].includes(text)) return "completed";
  if (["live", "in_play", "in-play", "playing"].includes(text)) return "live";
  if (["upcoming", "yet_to_play", "not_started", "not-started", "locked"].includes(text)) return "yet_to_play";
  return text;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function pickPlayerName(player) {
  return player?.name ?? player?.playerName ?? player?.displayName ?? player?.nickname ?? null;
}

function pickPosition(player) {
  return player?.position ?? player?.positionCode ?? player?.role ?? null;
}

function pickPoints(player) {
  return player?.points ?? player?.score ?? player?.totalPoints ?? player?.fantasyPoints ?? null;
}

function normalizePlayer(player, role, slot = null, overrides = {}) {
  const objectPlayer = player && typeof player === "object" ? player : {};
  const fifaPlayerId = typeof player === "number"
    ? player
    : (objectPlayer.id ?? objectPlayer.playerId ?? objectPlayer.fifaPlayerId ?? null);
  return {
    name: pickPlayerName(objectPlayer),
    fifaPlayerId,
    position: overrides.position ?? pickPosition(objectPlayer),
    status: normalizeStatusFromText(objectPlayer?.status ?? objectPlayer?.matchStatus ?? objectPlayer?.fixtureStatus ?? overrides.status),
    points: pickPoints(objectPlayer),
    captain: Boolean(objectPlayer?.captain ?? objectPlayer?.isCaptain ?? overrides.captain),
    viceCaptain: Boolean(objectPlayer?.viceCaptain ?? objectPlayer?.isViceCaptain ?? overrides.viceCaptain),
    slot,
    role
  };
}

function scoreCandidate(candidate) {
  let score = 0;
  const lineup = toArray(candidate?.lineup ?? candidate?.startingXI ?? candidate?.starters ?? candidate?.players);
  const bench = toArray(candidate?.bench ?? candidate?.substitutes ?? candidate?.subs);
  if (lineup.length >= 11) score += 5;
  if (bench.length >= 3) score += 3;
  if (Number.isFinite(candidate?.totalPoints ?? candidate?.points)) score += 2;
  if (lineup.some((player) => player?.captain || player?.isCaptain)) score += 2;
  return score;
}

export function normalizeFifaTeamPayload(payload) {
  const root = payload?.success ?? payload;
  const idBasedLineup = root?.lineup && !Array.isArray(root.lineup) ? root.lineup : null;
  const idBasedBench = root?.bench && !Array.isArray(root.bench) ? root.bench : null;
  const looksLikeIdBasedTeam = Boolean(idBasedLineup && typeof idBasedLineup === "object");

  if (looksLikeIdBasedTeam) {
    const orderedLineup = [
      ...toArray(idBasedLineup.GK).map((id) => normalizePlayer(id, "lineup", null, { position: "G", captain: id === root.captain, viceCaptain: id === root.vice })),
      ...toArray(idBasedLineup.DEF).map((id) => normalizePlayer(id, "lineup", null, { position: "D", captain: id === root.captain, viceCaptain: id === root.vice })),
      ...toArray(idBasedLineup.MID).map((id) => normalizePlayer(id, "lineup", null, { position: "M", captain: id === root.captain, viceCaptain: id === root.vice })),
      ...toArray(idBasedLineup.FWD).map((id) => normalizePlayer(id, "lineup", null, { position: "F", captain: id === root.captain, viceCaptain: id === root.vice }))
    ];
    const orderedBench = [
      ...toArray(idBasedBench?.GK).map((id) => normalizePlayer(id, "bench", null, { position: "G" })),
      ...toArray(idBasedBench?.DEF).map((id) => normalizePlayer(id, "bench", null, { position: "D" })),
      ...toArray(idBasedBench?.MID).map((id) => normalizePlayer(id, "bench", null, { position: "M" })),
      ...toArray(idBasedBench?.FWD).map((id) => normalizePlayer(id, "bench", null, { position: "F" }))
    ];
    const benchOrder = toArray(root.benchOrder);
    const bench = orderedBench
      .sort((a, b) => {
        const aIndex = benchOrder.indexOf(a.fifaPlayerId);
        const bIndex = benchOrder.indexOf(b.fifaPlayerId);
        return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
      })
      .map((player, index) => ({ ...player, slot: index }));

    return {
      normalized: {
        fetchedAt: new Date().toISOString(),
        source: "play.fifa.com/fantasy/team",
        teamName: root.teamName ?? root.name ?? null,
        totalPoints: root.roundPoints ?? root.overallPoints ?? root.totalPoints ?? root.points ?? null,
        roundPoints: root.roundPoints ?? null,
        overallPoints: root.overallPoints ?? null,
        lineup: orderedLineup,
        bench
      },
      diagnostics: {
        lineupCount: orderedLineup.length,
        benchCount: bench.length,
        idBased: true
      }
    };
  }

  const candidates = deepFind(payload, (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const lineup = toArray(value.lineup ?? value.startingXI ?? value.starters ?? value.players);
    const bench = toArray(value.bench ?? value.substitutes ?? value.subs);
    return lineup.length >= 11 || (lineup.length >= 8 && bench.length >= 3);
  }).map((entry) => entry.value);

  const best = candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0];
  if (!best) {
    return {
      normalized: null,
      diagnostics: {
        reason: "No plausible squad object found in payload"
      }
    };
  }

  const lineupSource = toArray(best.lineup ?? best.startingXI ?? best.starters ?? best.players);
  const benchSource = toArray(best.bench ?? best.substitutes ?? best.subs);

  const lineup = lineupSource.map((player) => normalizePlayer(player, "lineup"));
  const bench = benchSource.map((player, index) => normalizePlayer(player, "bench", index));
  const totalPoints = best.totalPoints ?? best.points ?? root.totalPoints ?? root.points ?? payload.totalPoints ?? payload.points ?? null;

  return {
    normalized: {
      fetchedAt: new Date().toISOString(),
      source: "play.fifa.com/fantasy/team",
      teamName: best.teamName ?? best.name ?? root.teamName ?? payload.teamName ?? null,
      totalPoints,
      lineup,
      bench
    },
    diagnostics: {
      lineupCount: lineup.length,
      benchCount: bench.length
    }
  };
}

export function displayName(player) {
  if (!player) return null;
  return player.knownName ?? ([player.firstName, player.lastName].filter(Boolean).join(" ") || null);
}
