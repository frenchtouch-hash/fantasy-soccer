import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const inputFile = resolve("data/fantalens-players-rounds-1-2.json");
const fallbackInputFile = resolve("data/fantalens-players.json");
const outFile = resolve("data/recommended-squad.json");
const rulesFile = resolve("data/fifa-rules.json");

const POSITION_CANDIDATES = { G: 18, D: 24, M: 24, F: 24 };
const COMBOS_TO_KEEP = { G: 1500, D: 1600, M: 1600, F: 2200 };
const PAIR_COMBOS_TO_KEEP = 15000;

const rules = JSON.parse(await readFile(rulesFile, "utf8"));
const BUDGET_TENTHS = Math.round(rules.squadCreation.initialBudget * 10);
const COUNTRY_LIMIT = rules.squadCreation.countryLimitsByStage["Group Stage"];
const SQUAD_SHAPE = rules.squadCreation.positions;
const SCOUTING_BONUS = rules.scoring.bonus.scoutingBonus;
const SCOUTING_BONUS_PROBABILITY_SCALE = 1.25;
const SCOUTING_BONUS_WEIGHT = 0.75;

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function probabilityMoreThanFourPoints(player) {
  const appearanceConfidence = Math.min(player.startProb ?? 1, player.p60 ?? 1);
  const performanceProbability = sigmoid(
    (Number(player.xpts) - SCOUTING_BONUS.requiresMoreThanPointsInMatch) /
      SCOUTING_BONUS_PROBABILITY_SCALE
  );
  return appearanceConfidence * performanceProbability;
}

function expectedScoutingBonus(player) {
  if (player.ownership == null || player.ownership >= SCOUTING_BONUS.ownershipBelowPercent) return 0;
  return SCOUTING_BONUS.points * probabilityMoreThanFourPoints(player) * SCOUTING_BONUS_WEIGHT;
}

function priceTenths(price) {
  return Math.round(Number(price) * 10);
}

function positionName(position) {
  return { G: "GK", D: "DEF", M: "MID", F: "FWD" }[position] ?? position;
}

function countryCounts(players) {
  const counts = new Map();
  for (const player of players) {
    counts.set(player.teamCode, (counts.get(player.teamCode) ?? 0) + 1);
  }
  return counts;
}

function canMergeCounts(a, b) {
  for (const [code, count] of b) {
    if ((a.get(code) ?? 0) + count > COUNTRY_LIMIT) return false;
  }
  return true;
}

function mergeCounts(a, b) {
  const result = new Map(a);
  for (const [code, count] of b) {
    result.set(code, (result.get(code) ?? 0) + count);
  }
  return result;
}

function comboFrom(players) {
  return {
    players,
    price: players.reduce((sum, player) => sum + priceTenths(player.price), 0),
    xpts: players.reduce((sum, player) => sum + Number(player.xpts), 0),
    adjustedXpts: players.reduce((sum, player) => sum + Number(player.adjustedXpts), 0),
    counts: countryCounts(players)
  };
}

function generateCombos(candidates, size, keep) {
  const combos = [];
  const picked = [];

  function walk(start, remaining) {
    if (remaining === 0) {
      const combo = comboFrom([...picked]);
      if (combo.price <= BUDGET_TENTHS && [...combo.counts.values()].every((count) => count <= COUNTRY_LIMIT)) {
        combos.push(combo);
      }
      return;
    }

    for (let index = start; index <= candidates.length - remaining; index += 1) {
      picked.push(candidates[index]);
      walk(index + 1, remaining - 1);
      picked.pop();
    }
  }

  walk(0, size);
  combos.sort((a, b) => b.adjustedXpts - a.adjustedXpts || b.xpts - a.xpts || a.price - b.price);
  return combos.slice(0, keep);
}

function mergeCombo(a, b) {
  if (a.price + b.price > BUDGET_TENTHS) return null;
  if (!canMergeCounts(a.counts, b.counts)) return null;
  return {
    players: [...a.players, ...b.players],
    price: a.price + b.price,
    xpts: a.xpts + b.xpts,
    adjustedXpts: a.adjustedXpts + b.adjustedXpts,
    counts: mergeCounts(a.counts, b.counts)
  };
}

function combineLists(leftList, rightList, keep) {
  const merged = [];
  for (const left of leftList) {
    for (const right of rightList) {
      const combo = mergeCombo(left, right);
      if (combo) merged.push(combo);
    }
  }
  merged.sort((a, b) => b.adjustedXpts - a.adjustedXpts || b.xpts - a.xpts || a.price - b.price);
  return merged.slice(0, keep);
}

let data;
let actualInputFile = inputFile;
try {
  data = JSON.parse(await readFile(inputFile, "utf8"));
} catch (error) {
  actualInputFile = fallbackInputFile;
  data = JSON.parse(await readFile(fallbackInputFile, "utf8"));
}
const usable = data.players
  .filter((player) => Number.isFinite(player.xpts) && Number.isFinite(player.price))
  .filter((player) => player.startProb == null || player.startProb >= 0.5)
  .filter((player) => player.p60 == null || player.p60 >= 0.5)
  .map((player) => {
    const scoutingBonus = expectedScoutingBonus(player);
    const scoutingBonusProbability = player.ownership < SCOUTING_BONUS.ownershipBelowPercent
      ? probabilityMoreThanFourPoints(player)
      : 0;
    return {
      ...player,
      scoutingBonus,
      scoutingBonusProbability,
      adjustedXpts: Number(player.xpts) + scoutingBonus
    };
  });

const byPosition = Object.fromEntries(Object.keys(SQUAD_SHAPE).map((position) => {
  const players = usable
    .filter((player) => player.position === position)
    .sort((a, b) => b.xpts - a.xpts || a.price - b.price)
    .slice(0, POSITION_CANDIDATES[position]);
  return [position, players];
}));

const positionCombos = {};
for (const [position, size] of Object.entries(SQUAD_SHAPE)) {
  positionCombos[position] = generateCombos(
    byPosition[position],
    size,
    COMBOS_TO_KEEP[position]
  );
}

const backHalf = combineLists(positionCombos.D, positionCombos.M, PAIR_COMBOS_TO_KEEP);
const frontHalf = combineLists(positionCombos.G, positionCombos.F, PAIR_COMBOS_TO_KEEP);

let best = null;
for (const front of frontHalf) {
  for (const back of backHalf) {
    if (best && front.adjustedXpts + back.adjustedXpts < best.adjustedXpts) break;
    const squad = mergeCombo(front, back);
    if (!squad) continue;
    if (
      !best ||
      squad.adjustedXpts > best.adjustedXpts ||
      (squad.adjustedXpts === best.adjustedXpts && squad.xpts > best.xpts) ||
      (squad.adjustedXpts === best.adjustedXpts && squad.xpts === best.xpts && squad.price < best.price)
    ) {
      best = squad;
      break;
    }
  }
}

if (!best) {
  throw new Error("No valid squad found");
}

const players = best.players
  .sort((a, b) => a.position.localeCompare(b.position) || b.xpts - a.xpts)
  .map((player) => ({
    position: positionName(player.position),
    name: player.name,
    team: player.teamCode,
    price: player.price,
    xpts: Number(player.xpts.toFixed(2)),
    scoutingBonus: Number(player.scoutingBonus.toFixed(2)),
    scoutingBonusProbability: Number(player.scoutingBonusProbability.toFixed(3)),
    adjustedXpts: Number(player.adjustedXpts.toFixed(2)),
    ownership: player.ownership,
    startProb: player.startProb,
    p60: player.p60,
    setPieces: player.setPieces,
    fixtures: player.cells?.map((cell) => ({
      round: cell.round_fifa_id,
      opponent: cell.opp_code,
      winChance: cell.p_win,
      xpts: cell.xpts
    })) ?? []
  }));

const output = {
  generatedAt: new Date().toISOString(),
  source: data.source,
  rulesSource: rules.source,
  method: {
    budget: rules.squadCreation.initialBudget,
    countryLimit: COUNTRY_LIMIT,
    shape: { GK: 2, DEF: 5, MID: 5, FWD: 3 },
    objective: "Maximize FantaLens Matchday 1+2 adjusted xPts, including a 0.75x weighted expected Matchday 1 scouting bonus for under-5%-owned players, using players with startProb/p60 >= 50%, within official FIFA group-stage constraints.",
    scoringModel: {
      base: "FantaLens Matchday 1+2 xPts",
      scoutingBonus: `+${SCOUTING_BONUS.points} * P(score > ${SCOUTING_BONUS.requiresMoreThanPointsInMatch}) * ${SCOUTING_BONUS_WEIGHT} when ownership < ${SCOUTING_BONUS.ownershipBelowPercent}%`,
      scoutingBonusProbability: `min(startProb, p60) * sigmoid((xPts - ${SCOUTING_BONUS.requiresMoreThanPointsInMatch}) / ${SCOUTING_BONUS_PROBABILITY_SCALE})`
    },
    inputFile: actualInputFile,
    projectedRounds: data.rounds ?? [1],
    candidateCaps: POSITION_CANDIDATES,
    positionCombosKept: COMBOS_TO_KEEP,
    pairCombosKept: PAIR_COMBOS_TO_KEEP
  },
  totals: {
    price: best.price / 10,
    xpts: Number(best.xpts.toFixed(2)),
    scoutingBonus: Number((best.adjustedXpts - best.xpts).toFixed(2)),
    adjustedXpts: Number(best.adjustedXpts.toFixed(2))
  },
  countryCounts: Object.fromEntries([...best.counts.entries()].sort()),
  players
};

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify(output, null, 2)}\n`);

console.log(`Recommended squad: ${output.totals.adjustedXpts} adjusted xPts (${output.totals.xpts} base + ${output.totals.scoutingBonus} scouting), $${output.totals.price.toFixed(1)}m`);
for (const player of players) {
  console.log(`${player.position.padEnd(3)} ${player.name.padEnd(24)} ${player.team} $${String(player.price).padEnd(4)} ${String(player.adjustedXpts).padEnd(5)} adj (${player.xpts}+${player.scoutingBonus}) scoutP ${player.scoutingBonusProbability} own ${player.ownership}%`);
}
