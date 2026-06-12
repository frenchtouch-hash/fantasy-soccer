import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataDir = path.join(repoRoot, "data");
const dashboardPath = path.join(repoRoot, "dashboard", "live-round1.html");

const state = JSON.parse(
  await fs.readFile(path.join(dataDir, "live-round1-state.json"), "utf8")
);
const advice = JSON.parse(
  await fs.readFile(path.join(dataDir, "live-round1-advice.json"), "utf8")
);
const fifa = JSON.parse(
  await fs.readFile(path.join(dataDir, "live-fifa-team.json"), "utf8")
);
const projections = JSON.parse(
  await fs.readFile(
    path.join(dataDir, "fantalens-players-rounds-1-2.json"),
    "utf8"
  )
);

const now = new Date();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatEt(dateString, options = {}) {
  if (!dateString) {
    return "-";
  }

  const date = new Date(dateString);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: options.withWeekday ? "short" : undefined,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

function formatExactTimestamp(dateString) {
  if (!dateString) {
    return "-";
  }

  const date = new Date(dateString);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short"
  }).format(date);
}

function formatRelativeFuture(dateString) {
  if (!dateString) {
    return "-";
  }

  const target = new Date(dateString);
  const diffMs = target.getTime() - now.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const dayDiff = Math.floor(
    (Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
      dayMs
  );

  if (dayDiff === 0) {
    return "today";
  }
  if (dayDiff === 1) {
    return "tomorrow";
  }
  if (dayDiff === 2) {
    return "in two days";
  }
  if (dayDiff > 2) {
    return `in ${dayDiff} days`;
  }

  const hours = Math.max(1, Math.round(diffMs / (60 * 60 * 1000)));
  return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
}

function formatRelativePast(dateString) {
  if (!dateString) {
    return "-";
  }

  const target = new Date(dateString);
  const diffMs = now.getTime() - target.getTime();

  if (diffMs < 60 * 1000) {
    return "just now";
  }

  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 60) {
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }

  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function formatNextDecision(dateString) {
  if (!dateString) {
    return "No pending decision";
  }

  return `<span class="relative-time" data-timestamp="${escapeHtml(
    dateString
  )}" data-mode="future">${escapeHtml(
    formatRelativeFuture(dateString)
  )}</span><br><span class="muted" title="${escapeHtml(
    formatExactTimestamp(dateString)
  )}">${escapeHtml(formatEt(dateString, { withWeekday: true }))}</span>`;
}

function findPlayerProjection(name, round = 1) {
  const player = projections.players.find((entry) => entry.name === name);
  if (!player) {
    return null;
  }

  const cell = player.cells.find((entry) => entry.round_fifa_id === round);
  if (!cell) {
    return null;
  }

  return {
    name: player.name,
    xpts: cell.xpts,
    opponent: cell.opp_code
  };
}

function deriveCaptainSuggestions() {
  const starters = state.lineup
    .map((player) => findPlayerProjection(player.name, state.round))
    .filter(Boolean)
    .sort((a, b) => b.xpts - a.xpts);

  return {
    captain: starters[0] ?? null,
    viceCaptain: starters[1] ?? null
  };
}

function getTeamDetails(player) {
  const merged =
    [...fifa.lineup, ...fifa.bench].find(
      (entry) => entry.fifaPlayerId === player.fifaPlayerId
    ) ?? {};

  return {
    team: merged.team ?? "",
    teamCode: merged.teamCode ?? "",
    opponent: merged.opponent ?? "",
    fixture: merged.fixture ?? null
  };
}

function teamCodeToFlagCode(teamCode) {
  const map = {
    ARG: "ar",
    AUS: "au",
    AUT: "at",
    BEL: "be",
    BRA: "br",
    CAN: "ca",
    CHI: "cl",
    CIV: "ci",
    CMR: "cm",
    COD: "cd",
    COL: "co",
    CPV: "cv",
    CRO: "hr",
    CUW: "cw",
    CZE: "cz",
    DCO: "cd",
    ECU: "ec",
    EGY: "eg",
    ENG: "gb-eng",
    ESP: "es",
    FRA: "fr",
    GER: "de",
    GHA: "gh",
    HAI: "ht",
    IRA: "iq",
    IRI: "ir",
    IRQ: "iq",
    ITA: "it",
    JPN: "jp",
    KOR: "kr",
    KSA: "sa",
    MAR: "ma",
    MEX: "mx",
    NED: "nl",
    NOR: "no",
    NZL: "nz",
    PAN: "pa",
    POL: "pl",
    POR: "pt",
    QAT: "qa",
    RSA: "za",
    SCO: "gb-sct",
    SEN: "sn",
    SRB: "rs",
    SUI: "ch",
    SWE: "se",
    TUN: "tn",
    URU: "uy",
    USA: "us",
    UZB: "uz",
    WAL: "gb-wls"
  };

  return (map[teamCode] ?? teamCode ?? "").toLowerCase();
}

function renderTeamBlock(player) {
  const { team, teamCode } = getTeamDetails(player);
  if (!team || !teamCode) {
    return "";
  }

  const flagCode = teamCodeToFlagCode(teamCode);
  return `<div class="player-team muted"><img class="flag-icon" src="https://flagcdn.com/w20/${escapeHtml(
    flagCode
  )}.png" alt="${escapeHtml(team)} flag">${escapeHtml(team)}</div>`;
}

function renderFixture(player) {
  const { teamCode, opponent, fixture } = getTeamDetails(player);

  if (!fixture) {
    return '<span class="muted">-</span>';
  }

  const matchup = `${teamCode} vs ${opponent}`;
  if (fixture.status === "complete") {
    return `${escapeHtml(matchup)}<br><span class="muted">${escapeHtml(
      fixture.score ?? ""
    )}</span>`;
  }

  return `${escapeHtml(matchup)}<br><span class="muted relative-time" data-timestamp="${escapeHtml(
    fixture.kickoffEt
  )}" data-mode="future" title="${escapeHtml(
    formatExactTimestamp(fixture.kickoffEt)
  )}">${escapeHtml(formatRelativeFuture(fixture.kickoffEt))}</span><br><span class="muted">${escapeHtml(
    formatEt(fixture.kickoffEt, { withWeekday: true })
  )}</span>`;
}

function renderPoints(player) {
  if (player.points == null) {
    return '<span class="muted">-</span>';
  }
  if (player.rawPoints != null && player.rawPoints !== player.points) {
    return `${player.points} <span class="muted">(raw ${player.rawPoints})</span>`;
  }
  return String(player.points);
}

function renderStatus(status) {
  const map = {
    completed: "Completed",
    yet_to_play: "Yet to play",
    live: "Live"
  };
  return map[status] ?? status;
}

function renderRoleBadges(player, isBench = false) {
  const badges = [];
  if (player.captain) {
    badges.push("C");
  }
  if (player.viceCaptain) {
    badges.push("VC");
  }
  if (isBench) {
    badges.push("Bench");
  }

  return badges
    .map((badge) => `<span class="badge">${escapeHtml(badge)}</span>`)
    .join("");
}

function renderPlayerRow(player, isBench = false) {
  return `<tr>
    <td>${escapeHtml(player.name)} ${renderRoleBadges(player, isBench)}${renderTeamBlock(
      player
    )}</td>
    <td>${escapeHtml(player.position)}</td>
    <td>${escapeHtml(renderStatus(player.status))}</td>
    <td>${renderPoints(player)}</td>
    <td>${renderFixture(player)}</td>
  </tr>`;
}

function renderActionList() {
  const items =
    advice.concreteActions.length > 0
      ? advice.concreteActions.map((action) => {
          const deadline = action.deadline
            ? ` Decision window: before ${formatEt(action.deadline, {
                withWeekday: true
              })}.`
            : "";
          return `<li><strong>${escapeHtml(action.move)}.</strong> ${escapeHtml(
            action.reason
          )}${escapeHtml(deadline)}</li>`;
        })
      : [
          "<li><strong>No action needed right now.</strong> Hold the current setup and reassess before the next relevant kickoff.</li>"
        ];

  return items.join("");
}

const captainSuggestion = deriveCaptainSuggestions();
const nextDecisionWindow = advice.nextFixtures?.[0]?.kickoffEt ?? null;
const captainCard = advice.captain ?? {
  name: "None",
  points: null
};

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FIFA Fantasy Live Round ${state.round}</title>
  <style>
    :root {
      --bg: #06121f;
      --panel: #0d2238;
      --panel-2: #13304d;
      --text: #f4f7fb;
      --muted: #a7b8ca;
      --line: #234869;
      --accent: #41d3ff;
      --good: #7ee787;
      --warn: #ffd166;
      --font: "Segoe UI", system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font);
      background: radial-gradient(circle at top, #123963 0%, var(--bg) 45%, #040b14 100%);
      color: var(--text);
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 28px 20px 44px;
    }
    .hero, .panel {
      background: linear-gradient(180deg, rgba(19,48,77,.96), rgba(10,24,39,.96));
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: 0 18px 60px rgba(0,0,0,.22);
    }
    .hero {
      padding: 24px;
      display: grid;
      gap: 18px;
      margin-bottom: 18px;
    }
    .hero-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
    }
    .stat {
      background: rgba(255,255,255,.03);
      border: 1px solid rgba(255,255,255,.06);
      border-radius: 14px;
      padding: 14px;
    }
    .stat .label, .muted { color: var(--muted); }
    .stat .value {
      margin-top: 6px;
      font-size: 1.8rem;
      font-weight: 700;
    }
    .layout {
      display: grid;
      grid-template-columns: 1.05fr .95fr;
      gap: 18px;
    }
    .panel { padding: 20px; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 2rem; }
    h2 { font-size: 1.15rem; margin-bottom: 14px; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: .95rem;
    }
    th, td {
      text-align: left;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,.08);
      vertical-align: top;
    }
    th { color: var(--muted); font-weight: 600; }
    .badge {
      display: inline-block;
      margin-left: 6px;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(65,211,255,.12);
      border: 1px solid rgba(65,211,255,.25);
      color: var(--accent);
      font-size: .74rem;
      font-weight: 700;
    }
    .player-team {
      margin-top: 5px;
      font-size: .82rem;
      line-height: 1.2;
    }
    .flag-icon {
      width: 14px;
      height: 10px;
      object-fit: cover;
      border-radius: 2px;
      margin-right: 6px;
      vertical-align: -1px;
      box-shadow: 0 0 0 1px rgba(255,255,255,.12);
    }
    .action-list {
      margin: 0;
      padding-left: 18px;
      display: grid;
      gap: 12px;
    }
    .subtle-card {
      margin-top: 14px;
      padding: 14px;
      border-radius: 14px;
      background: rgba(255,255,255,.03);
      border: 1px solid rgba(255,255,255,.06);
    }
    .summary-line + .summary-line { margin-top: 8px; }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .hero { padding: 18px; }
      .panel { padding: 16px; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div>
        <p class="muted">Live monitor for ${escapeHtml(state.teamName)}</p>
        <h1>FIFA Fantasy Round ${state.round}</h1>
      </div>
      <div class="hero-grid">
        <div class="stat">
          <div class="label">Current points</div>
          <div class="value">${escapeHtml(state.totalPoints)}</div>
        </div>
        <div class="stat">
          <div class="label">Captain</div>
          <div class="value" style="font-size:1.25rem">${escapeHtml(
            captainCard.name
          )}</div>
          <div class="muted">${
            captainCard.points == null
              ? "No points yet"
              : `${escapeHtml(captainCard.points)} effective points`
          }</div>
        </div>
        <div class="stat">
          <div class="label">Action status</div>
          <div class="value" style="font-size:1.1rem;color:var(--good)">${
            advice.concreteActions.length > 0 ? "Move needed" : "No move now"
          }</div>
        </div>
        <div class="stat">
          <div class="label">Next decision window</div>
          <div class="value" style="font-size:1rem">${formatNextDecision(
            nextDecisionWindow
          )}</div>
        </div>
      </div>
    </section>

    <section class="layout">
      <div class="panel">
        <h2>Current squad</h2>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th>Status</th>
              <th>Points</th>
              <th>Fixture</th>
            </tr>
          </thead>
          <tbody>
            ${state.lineup.map((player) => renderPlayerRow(player)).join("")}
            ${state.bench.map((player) => renderPlayerRow(player, true)).join("")}
          </tbody>
        </table>
      </div>

      <div class="panel">
        <h2>What changes are needed</h2>
        <ol class="action-list">${renderActionList()}</ol>

        <div class="subtle-card">
          <h3>FantaLens captaincy suggestion</h3>
          <p class="summary-line">Round ${state.round} baseline captain: ${
            captainSuggestion.captain
              ? `${escapeHtml(captainSuggestion.captain.name)} (${escapeHtml(
                  captainSuggestion.captain.xpts.toFixed(2)
                )} xPts vs ${escapeHtml(captainSuggestion.captain.opponent)}).`
              : "Unavailable."
          }</p>
          <p class="summary-line">Round ${state.round} baseline vice-captain: ${
            captainSuggestion.viceCaptain
              ? `${escapeHtml(captainSuggestion.viceCaptain.name)} (${escapeHtml(
                  captainSuggestion.viceCaptain.xpts.toFixed(2)
                )} xPts vs ${escapeHtml(captainSuggestion.viceCaptain.opponent)}).`
              : "Unavailable."
          }</p>
          <p class="summary-line muted">This is the pre-kickoff FantaLens preference from your current starting XI. Live captain decisions above can differ once points are banked.</p>
        </div>

        <div class="subtle-card">
          <h3>Captain logic</h3>
          <p class="summary-line">${escapeHtml(advice.captainAdvice.reason)}</p>
          <p class="summary-line muted">Captain values here use effective points, so a completed captain already includes the double.</p>
        </div>

        <div class="subtle-card">
          <h3>Substitution thresholds</h3>
          ${advice.substitutionWindows
            .map(
              (window) =>
                `<p class="summary-line">${escapeHtml(window.starter)}: sub at ${escapeHtml(
                  window.threshold.subAt
                )} or below, borderline ${escapeHtml(
                  window.threshold.borderline
                )}, keep ${escapeHtml(window.threshold.keepAt)}+.</p>`
            )
            .join("")}
        </div>

        <div class="subtle-card">
          <h3>Monitor freshness</h3>
          <p class="summary-line muted">FIFA sync: <span class="relative-time" data-timestamp="${escapeHtml(
            fifa.fetchedAt
          )}" data-mode="past" title="${escapeHtml(
            formatExactTimestamp(fifa.fetchedAt)
          )}">${escapeHtml(formatRelativePast(fifa.fetchedAt))}</span></p>
          <p class="summary-line muted">Advice generated: <span class="relative-time" data-timestamp="${escapeHtml(
            advice.generatedAt
          )}" data-mode="past" title="${escapeHtml(
            formatExactTimestamp(advice.generatedAt)
          )}">${escapeHtml(formatRelativePast(advice.generatedAt))}</span></p>
          <p class="summary-line muted">Local state updated: <span class="relative-time" data-timestamp="${escapeHtml(
            state.updatedAt
          )}" data-mode="past" title="${escapeHtml(
            formatExactTimestamp(state.updatedAt)
          )}">${escapeHtml(formatRelativePast(state.updatedAt))}</span></p>
        </div>
      </div>
    </section>
  </main>
  <script>
    (() => {
      const futureLabel = (target, now) => {
        const diffMs = target.getTime() - now.getTime();
        const dayMs = 24 * 60 * 60 * 1000;
        const dayDiff = Math.floor(
          (Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) -
            Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / dayMs
        );

        if (dayDiff === 0) return "today";
        if (dayDiff === 1) return "tomorrow";
        if (dayDiff === 2) return "in two days";
        if (dayDiff > 2) return "in " + dayDiff + " days";

        const hours = Math.max(1, Math.round(diffMs / (60 * 60 * 1000)));
        return hours === 1 ? "in 1 hour" : "in " + hours + " hours";
      };

      const pastLabel = (target, now) => {
        const diffMs = now.getTime() - target.getTime();
        if (diffMs < 60 * 1000) return "just now";

        const minutes = Math.floor(diffMs / (60 * 1000));
        if (minutes < 60) return minutes === 1 ? "1 minute ago" : minutes + " minutes ago";

        const hours = Math.floor(minutes / 60);
        if (hours < 48) return hours === 1 ? "1 hour ago" : hours + " hours ago";

        const days = Math.floor(hours / 24);
        return days === 1 ? "1 day ago" : days + " days ago";
      };

      const refreshRelativeTimes = () => {
        const now = new Date();
        document.querySelectorAll(".relative-time[data-timestamp]").forEach((node) => {
          const raw = node.getAttribute("data-timestamp");
          const mode = node.getAttribute("data-mode");
          if (!raw || !mode) return;

          const target = new Date(raw);
          if (Number.isNaN(target.getTime())) return;

          node.textContent = mode === "future"
            ? futureLabel(target, now)
            : pastLabel(target, now);
        });
      };

      refreshRelativeTimes();
      window.setInterval(refreshRelativeTimes, 60000);
    })();
  </script>
</body>
</html>
`;

await fs.writeFile(dashboardPath, html);
console.log(`Rendered ${dashboardPath}`);
