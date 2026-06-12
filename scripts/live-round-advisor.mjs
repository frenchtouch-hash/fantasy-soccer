import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const stateFile = resolve("data/live-round1-state.json");
const fixturesFile = resolve("data/live-round1-fixtures.json");
const projectionsFile = resolve("data/fantalens-players-rounds-1-2.json");
const rulesFile = resolve("data/fifa-rules.json");
const outFile = resolve("data/live-round1-advice.json");

const [state, fixtureData, projectionsData, rules] = await Promise.all([
  JSON.parse(await readFile(stateFile, "utf8")),
  JSON.parse(await readFile(fixturesFile, "utf8")),
  JSON.parse(await readFile(projectionsFile, "utf8")),
  JSON.parse(await readFile(rulesFile, "utf8"))
]);

const fixturesByTeam = new Map(fixtureData.fixtures.map((fixture) => [fixture.team, fixture]));
const projectionsByName = new Map(projectionsData.players.map((player) => [player.name, player]));
const validFormations = new Set(rules.squadCreation.validFormations);

function describeFormation(counts) {
  return `${counts.D}-${counts.M}-${counts.F}`;
}

function countsFromLineup(players) {
  return players.reduce((counts, player) => {
    counts[player.position] += 1;
    return counts;
  }, { G: 0, D: 0, M: 0, F: 0 });
}

function canSwap(lineupCounts, starterPosition, benchPosition) {
  const counts = { ...lineupCounts };
  counts[starterPosition] -= 1;
  counts[benchPosition] += 1;
  if (counts.G !== 1) return false;
  return validFormations.has(describeFormation(counts));
}

function summarizeThreshold(expectedPoints) {
  const subAt = Math.max(0, Math.floor(expectedPoints - 1));
  const borderline = Math.max(subAt + 1, Math.floor(expectedPoints));
  const keepAt = Math.max(borderline + 1, Math.ceil(expectedPoints));
  return { subAt, borderline, keepAt };
}

function fixtureFor(player) {
  const projection = projectionsByName.get(player.name);
  const team = projection?.teamCode ?? null;
  const fixture = team ? fixturesByTeam.get(team) : null;
  return {
    team,
    opponent: projection?.cells?.find((cell) => cell.round_fifa_id === 1)?.opp_code ?? fixture?.opponent ?? null,
    kickoffEt: fixture?.kickoffEt ?? null,
    source: fixture?.source ?? null,
    xPts: projection?.cells?.find((cell) => cell.round_fifa_id === 1)?.xpts ?? null
  };
}

const lineup = state.lineup.map((player) => ({ ...player, fixture: fixtureFor(player) }));
const bench = state.bench.map((player) => ({ ...player, fixture: fixtureFor(player) }));
const lineupCounts = countsFromLineup(lineup);
const upcomingStarters = lineup
  .filter((player) => player.status === "yet_to_play" && Number.isFinite(player.fixture.xPts))
  .sort((a, b) => (
    b.fixture.xPts - a.fixture.xPts ||
    String(a.fixture.kickoffEt).localeCompare(String(b.fixture.kickoffEt))
  ));

const nextFixtures = [...lineup, ...bench]
  .filter((player) => player.status === "yet_to_play" && player.fixture.kickoffEt)
  .sort((a, b) => a.fixture.kickoffEt.localeCompare(b.fixture.kickoffEt))
  .map((player) => ({
    name: player.name,
    position: player.position,
    opponent: player.fixture.opponent,
    kickoffEt: player.fixture.kickoffEt,
    status: player.status,
    lineupRole: state.lineup.some((starter) => starter.name === player.name) ? "starter" : `bench-${player.slot}`
  }));

const captain = lineup.find((player) => player.captain);
const captainSwitchTarget = upcomingStarters[0] ?? null;
const captainAdvice = captain?.status === "completed" && (captain.points ?? 0) >= 10
  ? {
      action: "hold",
      reason: `${captain.name} already has ${captain.points} effective points. Changing captain would forfeit those doubled points.`,
      recommendedTarget: null,
      deadline: null
    }
  : captain?.status === "completed" && captainSwitchTarget
    ? {
        action: "change",
        reason: `${captain.name} has only ${captain.points ?? 0} effective points. ${captainSwitchTarget.name} is the best remaining starter at ${captainSwitchTarget.fixture.xPts.toFixed(2)} projected points.`,
        recommendedTarget: {
          name: captainSwitchTarget.name,
          position: captainSwitchTarget.position,
          kickoffEt: captainSwitchTarget.fixture.kickoffEt,
          xPts: captainSwitchTarget.fixture.xPts
        },
        deadline: captainSwitchTarget.fixture.kickoffEt
      }
    : captain?.status === "completed"
      ? {
          action: "hold",
          reason: `${captain.name} is completed and no better captain target remains.`,
          recommendedTarget: null,
          deadline: null
        }
      : {
          action: "pending",
          reason: `${captain?.name ?? "Captain"} has not completed their fixture yet.`,
          recommendedTarget: null,
          deadline: null
        };

const benchOptions = bench.filter((player) => player.status === "yet_to_play");
const substitutionWindows = lineup
  .filter((player) => player.status === "completed")
  .map((starter) => {
    const candidates = benchOptions
      .filter((benchPlayer) => canSwap(lineupCounts, starter.position, benchPlayer.position))
      .map((benchPlayer) => ({
        name: benchPlayer.name,
        position: benchPlayer.position,
        xPts: benchPlayer.fixture.xPts,
        kickoffEt: benchPlayer.fixture.kickoffEt
      }))
      .filter((benchPlayer) => Number.isFinite(benchPlayer.xPts))
      .sort((a, b) => b.xPts - a.xPts);

    if (!candidates.length) {
      return {
        starter: starter.name,
        currentPoints: starter.points,
        action: "hold",
        reason: "No eligible bench replacement remains."
      };
    }

    const best = candidates[0];
    const threshold = summarizeThreshold(best.xPts);
    const recommended = (starter.points ?? 0) <= threshold.subAt;

    return {
      starter: starter.name,
      currentPoints: starter.points,
      bestReplacement: best,
      eligibleReplacements: candidates,
      threshold,
      action: recommended ? "sub-out" : "hold",
      deadline: recommended ? best.kickoffEt : null,
      reason: recommended
        ? `${starter.name} has ${starter.points} points. ${best.name} projects for ${best.xPts.toFixed(2)} and is still to play.`
        : `${starter.name} already has enough banked points to justify holding for now.`
    };
  });

const concreteActions = [];
if (captainAdvice.action === "change" && captain && captainAdvice.recommendedTarget) {
  concreteActions.push({
    type: "captain-change",
    move: `Change captain from ${captain.name} to ${captainAdvice.recommendedTarget.name}.`,
    deadline: captainAdvice.deadline,
    reason: captainAdvice.reason
  });
}
for (const window of substitutionWindows.filter((entry) => entry.action === "sub-out" && entry.bestReplacement)) {
  concreteActions.push({
    type: "manual-sub",
    move: `Manually sub out ${window.starter} for ${window.bestReplacement.name}.`,
    deadline: window.deadline,
    reason: window.reason
  });
}

const recommendationSummary = [
  captainAdvice.action === "hold"
    ? `Captain: keep ${captain.name}.`
    : captainAdvice.action === "change"
      ? `Captain: switch from ${captain.name} to ${captainAdvice.recommendedTarget.name} before ${captainAdvice.deadline}.`
      : `Captain: ${captainAdvice.reason}`,
  ...substitutionWindows.map((window) => {
    if (!window.bestReplacement) return `${window.starter}: hold. ${window.reason}`;
    return `${window.starter}: sub if ${window.currentPoints ?? 0} is at or below ${window.threshold.subAt}; borderline at ${window.threshold.borderline}; keep at ${window.threshold.keepAt}+ (best replacement ${window.bestReplacement.name}, ${window.bestReplacement.xPts.toFixed(2)} xPts).`;
  })
];

const output = {
  generatedAt: new Date().toISOString(),
  input: {
    stateFile,
    fixturesFile,
    projectionsFile
  },
  totalPoints: state.totalPoints,
  captain: captain ? { name: captain.name, points: captain.points, status: captain.status } : null,
  captainAdvice,
  nextFixtures,
  substitutionWindows,
  concreteActions,
  recommendationSummary
};

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify(output, null, 2)}\n`);

console.log(`Live Round 1 advice generated: ${outFile}`);
for (const line of recommendationSummary) {
  console.log(`- ${line}`);
}
