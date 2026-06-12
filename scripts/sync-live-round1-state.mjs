import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { writeJson } from "./lib/fifa-session.mjs";

const sourceFile = resolve("data/live-fifa-team.json");
const targetFile = resolve("data/live-round1-state.json");

const fifaState = JSON.parse(await readFile(sourceFile, "utf8"));
const existingState = JSON.parse(await readFile(targetFile, "utf8"));

function indexPlayers(players) {
  const normalizeName = (value) => String(value ?? "")
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

  return {
    byId: new Map(players.filter((player) => player.fifaPlayerId != null).map((player) => [player.fifaPlayerId, player])),
    byName: new Map(players.filter((player) => player.name).map((player) => [normalizeName(player.name), player]))
  };
}

function findLivePlayer(index, player) {
  if (player.fifaPlayerId != null && index.byId.has(player.fifaPlayerId)) {
    return index.byId.get(player.fifaPlayerId);
  }
  const key = String(player.name ?? "")
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
  return index.byName.get(key) ?? null;
}

function mergePlayer(player, live) {
  if (!live) return player;
  return {
    ...player,
    fifaPlayerId: live.fifaPlayerId ?? player.fifaPlayerId ?? null,
    status: live.status ?? player.status,
    rawPoints: live.rawPoints ?? player.rawPoints ?? null,
    points: live.points ?? player.points,
    captain: live.captain ?? player.captain,
    viceCaptain: live.viceCaptain ?? player.viceCaptain
  };
}

const lineupIndex = indexPlayers(fifaState.lineup ?? []);
const benchIndex = indexPlayers(fifaState.bench ?? []);

const nextLineup = existingState.lineup.map((player) => mergePlayer(player, findLivePlayer(lineupIndex, player)));
const nextBench = existingState.bench.map((player) => mergePlayer(player, findLivePlayer(benchIndex, player)));

const updated = {
  ...existingState,
  updatedAt: fifaState.fetchedAt ?? new Date().toISOString(),
  totalPoints: fifaState.totalPoints ?? existingState.totalPoints,
  lineup: nextLineup,
  bench: nextBench,
  notes: "Auto-synced from play.fifa.com/fantasy/team with FIFA player ids, public player metadata, and effective captain points."
};

await writeJson(targetFile, updated);
console.log(`Updated ${targetFile} from ${sourceFile}`);
