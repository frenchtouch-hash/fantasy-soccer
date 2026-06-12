import {
  FIFA_CONFIG,
  createApiContext,
  displayName,
  fetchPublicFantasyData,
  isJsonResponse,
  launchFifaContext,
  normalizeFifaTeamPayload,
  pathExists,
  readJson,
  summarizeHeaders,
  writeJson
} from "./lib/fifa-session.mjs";

function scoreCandidate(candidate) {
  const url = candidate?.url ?? "";
  let score = 0;
  if (url.includes("/history/")) score += 5;
  if (url.endsWith("/team")) score += 1;
  return score;
}

async function fetchViaDiscoveredApi() {
  if (!await pathExists(FIFA_CONFIG.discoveryPath)) return null;
  const discovery = await readJson(FIFA_CONFIG.discoveryPath);
  const api = await createApiContext();
  const candidates = [...(discovery.candidates ?? [])].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));

  try {
    for (const candidate of candidates) {
      if (!candidate.url || candidate.status >= 400) continue;
      const response = await api.fetch(candidate.url, {
        method: candidate.method ?? "GET",
        headers: candidate.headers ?? {}
      });
      if (!response.ok()) continue;
      const type = response.headers()["content-type"] ?? "";
      if (!type.includes("json")) continue;

      const payload = await response.json();
      const normalized = normalizeFifaTeamPayload(payload);
      if (normalized.normalized) {
        return {
          method: "api",
          url: candidate.url,
          raw: payload,
          ...normalized
        };
      }
    }
  } finally {
    await api.dispose();
  }

  return null;
}

async function fetchViaBrowserCapture() {
  const captures = [];
  const { browser, context, page } = await launchFifaContext({ headless: true });

  page.on("response", async (response) => {
    if (!isJsonResponse(response)) return;
    try {
      const payload = await response.json();
      const normalized = normalizeFifaTeamPayload(payload);
      if (normalized.normalized) {
        captures.push({
          url: response.url(),
          status: response.status(),
          method: response.request().method(),
          headers: summarizeHeaders(response.request().headers()),
          payload,
          normalized
        });
      }
    } catch {
      // Ignore malformed or irrelevant JSON.
    }
  });

  await page.goto(FIFA_CONFIG.teamUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(12_000);

  await context.close();
  await browser.close();

  if (!captures.length) return null;
  const best = captures.sort((a, b) => scoreCandidate({ url: b.url }) - scoreCandidate({ url: a.url }))[0];
  return {
    method: "browser-capture",
    url: best.url,
    raw: best.payload,
    ...best.normalized
  };
}

function isoToEt(value) {
  if (!value) return null;
  const date = new Date(value);
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}-04:00`;
}

function mapFixtureStatus(status) {
  switch (status) {
    case "complete":
      return "completed";
    case "playing":
    case "in_progress":
    case "live":
      return "live";
    case "scheduled":
    case "pre_match":
      return "yet_to_play";
    default:
      return "unknown";
  }
}

function enrichTeamState(base, rawPayload, publicData) {
  const root = rawPayload?.success ?? rawPayload;
  const playersById = new Map(publicData.players.map((player) => [player.id, player]));
  const squadsById = new Map(publicData.squads.map((squad) => [squad.id, squad]));
  const activeRound = publicData.rounds.find((round) => round.status === "playing") ?? publicData.rounds[0] ?? null;
  const currentRoundId = activeRound?.id ?? root?.startRoundId ?? 1;
  const fixtureBySquadId = new Map();

  for (const tournament of activeRound?.tournaments ?? []) {
    const fixture = {
      tournamentId: tournament.id,
      status: tournament.status,
      kickoff: tournament.date,
      kickoffEt: isoToEt(tournament.date),
      homeSquadId: tournament.homeSquadId,
      awaySquadId: tournament.awaySquadId,
      homeScore: tournament.homeScore,
      awayScore: tournament.awayScore
    };
    fixtureBySquadId.set(tournament.homeSquadId, {
      ...fixture,
      squadId: tournament.homeSquadId,
      opponentSquadId: tournament.awaySquadId,
      home: true
    });
    fixtureBySquadId.set(tournament.awaySquadId, {
      ...fixture,
      squadId: tournament.awaySquadId,
      opponentSquadId: tournament.homeSquadId,
      home: false
    });
  }

  function normalizePlayer(player) {
    const meta = playersById.get(player.fifaPlayerId) ?? null;
    const squad = meta ? squadsById.get(meta.squadId) : null;
    const fixture = meta ? fixtureBySquadId.get(meta.squadId) : null;
    const opponent = fixture ? squadsById.get(fixture.opponentSquadId) : null;
    const roundPoints = meta?.stats?.roundPoints?.[String(currentRoundId)] ?? meta?.stats?.roundPoints?.[currentRoundId] ?? null;
    const rawPoints = Number.isFinite(roundPoints) ? roundPoints : null;
    const derivedStatus = fixture ? mapFixtureStatus(fixture.status) : player.status;
    const effectivePoints = player.captain && derivedStatus === "completed" && rawPoints != null
      ? rawPoints * 2
      : rawPoints;

    return {
      ...player,
      name: meta ? displayName(meta) : player.name,
      firstName: meta?.firstName ?? null,
      lastName: meta?.lastName ?? null,
      knownName: meta?.knownName ?? null,
      position: meta?.position?.replace("GK", "G").replace("DEF", "D").replace("MID", "M").replace("FWD", "F") ?? player.position,
      status: derivedStatus,
      rawPoints,
      points: effectivePoints,
      percentSelected: meta?.percentSelected ?? null,
      price: meta?.price ?? null,
      team: squad?.name ?? null,
      teamCode: squad?.abbr ?? null,
      opponent: opponent?.abbr ?? null,
      fixture: fixture
        ? {
            tournamentId: fixture.tournamentId,
            status: fixture.status,
            kickoff: fixture.kickoff,
            kickoffEt: fixture.kickoffEt,
            opponent: opponent?.abbr ?? null,
            score: fixture.home
              ? `${fixture.homeScore ?? "-"}-${fixture.awayScore ?? "-"}`
              : `${fixture.awayScore ?? "-"}-${fixture.homeScore ?? "-"}`
          }
        : null
    };
  }

  const lineup = base.lineup.map(normalizePlayer);
  const bench = base.bench.map(normalizePlayer);
  const captain = lineup.find((player) => player.captain) ?? null;

  return {
    ...base,
    currentRoundId,
    teamId: root?.id ?? null,
    startRoundId: root?.startRoundId ?? null,
    freeTransfers: root?.freeTransfers ?? null,
    negativeTransfers: root?.negativeTransfers ?? 0,
    totalPoints: base.totalPoints ?? root?.roundPoints ?? root?.overallPoints ?? null,
    roundPoints: root?.roundPoints ?? base.roundPoints ?? null,
    overallPoints: root?.overallPoints ?? base.overallPoints ?? null,
    captain,
    lineup,
    bench
  };
}

if (!await pathExists(FIFA_CONFIG.storageStatePath)) {
  throw new Error(
    `Missing FIFA auth state at ${FIFA_CONFIG.storageStatePath}. Run \`npm run bootstrap:fifa-auth\` first.`
  );
}

const baseResult = await fetchViaDiscoveredApi() ?? await fetchViaBrowserCapture();
if (!baseResult?.normalized) {
  throw new Error(
    `Unable to extract FIFA team state. Run \`npm run bootstrap:fifa-auth\` first, then \`npm run discover:fifa-api\`, and inspect ${FIFA_CONFIG.discoveryPath}.`
  );
}

const publicData = await fetchPublicFantasyData();
const enriched = enrichTeamState(baseResult.normalized, baseResult.raw, publicData);

await writeJson(FIFA_CONFIG.rawStatePath, {
  fetchedAt: new Date().toISOString(),
  fetchMethod: baseResult.method,
  url: baseResult.url,
  diagnostics: baseResult.diagnostics,
  raw: baseResult.raw
});
await writeJson(FIFA_CONFIG.normalizedStatePath, enriched);

console.log(`Saved raw FIFA team payload to ${FIFA_CONFIG.rawStatePath}`);
console.log(`Saved normalized FIFA team state to ${FIFA_CONFIG.normalizedStatePath}`);
console.log(`- Fetch method: ${baseResult.method}`);
console.log(`- Team ID: ${enriched.teamId ?? "unknown"}`);
console.log(`- Total points: ${enriched.totalPoints ?? "unknown"}`);
console.log(`- Captain: ${enriched.captain?.name ?? "unknown"} (${enriched.captain?.points ?? "?"} effective points)`);
