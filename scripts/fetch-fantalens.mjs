import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const rounds = process.argv.find((arg) => arg.startsWith("--rounds="))?.split("=")[1] ?? "1";
const safeRounds = rounds.replace(/[^0-9,]/g, "");
const roundSuffix = safeRounds === "1" ? "" : `-rounds-${safeRounds.replace(/,/g, "-")}`;
const outFile = resolve(`data/fantalens-players${roundSuffix}.json`);
const baseUrl = "https://fantalens.com/players";
const loginUrl = "https://fantalens.com/login";
const cookieJar = new Map();

function parseEnvFile(text) {
  const values = {};
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function loadRepoCredentials() {
  for (const path of [resolve(".env.local"), resolve(".env")]) {
    try {
      const values = parseEnvFile(await readFile(path, "utf8"));
      if (values.FANTALENS_EMAIL || values.FANTALENS_PASSWORD) {
        return {
          email: values.FANTALENS_EMAIL?.trim() ?? "",
          password: values.FANTALENS_PASSWORD ?? ""
        };
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return { email: "", password: "" };
}

function decodeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractPage(html) {
  const match = html.match(/<div id="app" data-page="([^"]+)"/);
  if (!match) {
    throw new Error("Could not find FantaLens Inertia data-page payload");
  }
  return JSON.parse(decodeHtml(match[1]));
}

function updateCookies(response) {
  for (const setCookie of response.headers.getSetCookie?.() ?? []) {
    const [cookie] = setCookie.split(";", 1);
    const equalsIndex = cookie.indexOf("=");
    if (equalsIndex === -1) continue;
    const name = cookie.slice(0, equalsIndex);
    const value = cookie.slice(equalsIndex + 1);
    cookieJar.set(name, value);
  }
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function fetchWithSession(url, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("accept", headers.get("accept") ?? "text/html,application/xhtml+xml");
  headers.set("user-agent", headers.get("user-agent") ?? "fifafantasy-local-optimizer/0.1");
  const cookies = cookieHeader();
  if (cookies) headers.set("cookie", cookies);

  const response = await fetch(url, {
    ...options,
    headers,
    redirect: options.redirect ?? "follow"
  });
  updateCookies(response);
  return response;
}

async function loginIfConfigured() {
  if (!credentials.email || !credentials.password) return { authenticated: false, hasPass: false };

  await fetchWithSession(loginUrl);
  const xsrf = cookieJar.get("XSRF-TOKEN");
  if (!xsrf) {
    throw new Error("FantaLens login failed: missing XSRF token cookie");
  }

  const body = new URLSearchParams({
    email: credentials.email,
    password: credentials.password,
    remember: "on"
  });
  const response = await fetchWithSession(loginUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "referer": loginUrl,
      "x-requested-with": "XMLHttpRequest",
      "x-xsrf-token": decodeURIComponent(xsrf)
    },
    body
  });

  if (!(response.status === 302 || response.ok)) {
    throw new Error(`FantaLens login failed: ${response.status}`);
  }

  const home = await fetchWithSession(`${baseUrl}?page=1&rounds=${safeRounds}`);
  if (!home.ok) {
    throw new Error(`FantaLens post-login fetch failed: ${home.status}`);
  }
  const page = extractPage(await home.text());
  return {
    firstPage: page,
    authenticated: Boolean(page.props?.auth?.user),
    hasPass: Boolean(page.props?.billing?.hasPass)
  };
}

function normalizePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    slug: player.slug,
    position: player.position,
    price: player.price,
    team: player.team?.name ?? null,
    teamCode: player.team?.name_code ?? null,
    ownership: player.ownership,
    xpts: player.xpts,
    floor: player.floor,
    value: player.value,
    startProb: player.start_prob,
    p60: player.p60,
    lowConfidence: player.low_confidence,
    setPieces: player.set_pieces,
    cells: player.cells
  };
}

async function fetchPage(page) {
  const params = new URLSearchParams({ page: String(page), rounds: safeRounds });
  const url = `${baseUrl}?${params.toString()}`;
  const response = await fetchWithSession(url);
  if (!response.ok) {
    throw new Error(`FantaLens request failed for page ${page}: ${response.status}`);
  }
  return extractPage(await response.text());
}

const repoCredentials = await loadRepoCredentials();
const credentials = {
  email: process.env.FANTALENS_EMAIL?.trim() || repoCredentials.email,
  password: process.env.FANTALENS_PASSWORD || repoCredentials.password
};

const loginState = await loginIfConfigured();
const first = loginState.firstPage ?? await fetchPage(1);
const lastPage = first.props.players.last_page;
const players = [...first.props.players.data.map(normalizePlayer)];

for (let page = 2; page <= lastPage; page += 1) {
  const payload = await fetchPage(page);
  players.push(...payload.props.players.data.map(normalizePlayer));
  process.stderr.write(`Fetched page ${page}/${lastPage}\r`);
}

players.sort((a, b) => b.xpts - a.xpts);

const requestedRounds = safeRounds.split(",").map(Number).filter(Number.isFinite);
const availableRounds = first.props.rounds ?? [];
const unlockedRequestedRounds = availableRounds
  .filter((round) => requestedRounds.includes(round.fifa_id) && round.has_data && !round.locked)
  .map((round) => round.fifa_id);
const missingUnlockedRounds = unlockedRequestedRounds.filter((roundId) => (
  !players.some((player) => player.cells?.some((cell) => cell.round_fifa_id === roundId))
));

if (missingUnlockedRounds.length) {
  const authHint = loginState.authenticated
    ? "Authenticated fetch did not expose the expected paid round data."
    : "Set FANTALENS_EMAIL and FANTALENS_PASSWORD before fetching paid rounds.";
  throw new Error(`Requested unlocked rounds missing from player cells: ${missingUnlockedRounds.join(", ")}. ${authHint}`);
}

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify({
  source: baseUrl,
  rounds: requestedRounds,
  fetchedAt: new Date().toISOString(),
  availableRounds,
  auth: {
    authenticated: loginState.authenticated,
    hasPass: loginState.hasPass
  },
  count: players.length,
  players
}, null, 2)}\n`);

console.log(`Saved ${players.length} players to ${outFile}`);
