# FIFA Fantasy Optimizer

Local helper scripts for choosing a FIFA World Cup Fantasy squad from public FantaLens projections, then using the browser session to select those players on `play.fifa.com/fantasy`.

## Commands

```powershell
npm run build
```

This fetches the FantaLens player explorer pages into `data/fantalens-players.json` and writes the recommended squad to `data/recommended-squad.json`.

## FIFA Team Sync

Use a browser-backed auth bootstrap once, then poll the FIFA team state from the authenticated app data:

```powershell
npm install
npx playwright install chromium
npm run bootstrap:fifa-auth
npm run discover:fifa-api
npm run fetch:fifa-team
npm run sync:live-round1-state
npm run live:round1
```

Or run the full sync pipeline in one step after setup:

```powershell
npm run sync:round1
```

To stage the public GitHub Pages output from the latest dashboard:

```powershell
npm run pages:stage
```

To refresh the FIFA data, rebuild the dashboard, and stage the Pages site in one command:

```powershell
npm run pages:refresh
```

To refresh, commit, and push the Pages site to GitHub from this machine:

```powershell
npm run pages:publish-local
```

What each command does:

- `npm run bootstrap:fifa-auth`: opens a real Chromium window on `https://play.fifa.com/fantasy/team` and saves authenticated session state to `.secrets/fifa-storage-state.json`
- `npm run discover:fifa-api`: records JSON/XHR responses used by the team page and stores likely candidate endpoints in `data/fifa-api-discovery.json`
- `npm run fetch:fifa-team`: first tries the discovered JSON endpoints directly, then falls back to browser network capture if needed; writes raw payloads to `data/live-fifa-team-raw.json` and normalized squad data to `data/live-fifa-team.json`
- `npm run sync:live-round1-state`: merges the normalized FIFA squad points/statuses into `data/live-round1-state.json`
- `npm run render:round1-dashboard`: writes a simple local HTML monitor to `dashboard/live-round1.html`
- `npm run pages:publish-local`: refreshes the dashboard, stages `docs/`, commits the change, and pushes `master` to `origin`
- `npm run pages:stage`: copies `dashboard/live-round1.html` to `docs/index.html` for GitHub Pages
- `npm run pages:refresh`: runs the full live sync, then stages `docs/index.html` for GitHub Pages
- `npm run sync:round1`: fetches live FIFA squad state, updates the local round state, regenerates live substitution/captain advice, and renders the dashboard page

The FIFA integration is intentionally two-layered:

- primary path: poll authenticated JSON endpoints behind the FIFA app
- fallback path: open the team page in Playwright and capture the same JSON responses from the browser session

That is substantially more robust than scraping rendered DOM text from the page on every run.

The normalized FIFA state now resolves:

- FIFA player ids to real player names and team codes via `https://play.fifa.com/json/fantasy/players.json` and `squads.json`
- current round fixtures/status from `https://play.fifa.com/json/fantasy/rounds.json`
- captain points correctly as effective doubled points for live captaincy decisions

## Publishing To GitHub Pages

The public-hosting split that actually works is:

1. This machine runs `npm run pages:refresh` every 3 hours.
2. That updates `docs/index.html` with fresh private FIFA data from your local authenticated session.
3. Your local machine commits and pushes `docs/` to GitHub.
4. GitHub Pages serves the latest pushed file publicly.

Why this split matters:

- GitHub Pages can host the page publicly.
- GitHub-hosted Actions cannot reliably refresh your private FIFA squad because they do not have your live FIFA login/session.
- So the refresh must happen locally, where `.secrets/fifa-storage-state.json` already works.

Once the repo exists on GitHub as `https://github.com/<owner>/<repo>`, the Pages URL is typically:

`https://<owner>.github.io/<repo>/`

If you configure GitHub Pages to publish from the `docs/` folder on the default branch, `docs/index.html` becomes the public landing page.

To install a Windows scheduled task that publishes every 3 hours from this machine:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-pages-schedule.ps1
```

That scheduled task calls `scripts/publish-github-pages.ps1`, which assumes:

- `origin` points at your GitHub repository
- pushing to `master` is the right default branch
- your local machine already has working Git credentials for push

## FantaLens Auth

The fetcher auto-loads `FANTALENS_EMAIL` and `FANTALENS_PASSWORD` from `.env.local` in the repo root before falling back to shell environment variables. That means `npm run fetch:fantalens` and `npm run build` can be run directly without re-exporting credentials each time.

## Live Round Monitoring

Use `npm run live:round1` to generate live captaincy and substitution guidance from:

- `data/live-round1-state.json` for your current XI, bench, captaincy and completed points
- `data/live-round1-fixtures.json` for the remaining Round 1 kickoff order
- `data/fantalens-players-rounds-1-2.json` for projected points

Update `data/live-round1-state.json` as players finish matches and rerun the script to get the next decision window.

## Official Rules Ingested

The official FIFA guidelines have been captured in `data/fifa-rules.json` from `https://play.fifa.com/fantasy/help/guidelines`.

The rules file covers registration, squad creation, country caps by stage, budget changes, formations, captaincy, automatic and manual substitutions, live-round lock behavior, boosters, transfer allocations and penalties, scoring, leaderboards, and mini leagues.

## Current Rules Used

- Budget: `$100m`
- Squad: `2 GK`, `5 DEF`, `5 MID`, `3 FWD`
- Group-stage country cap: max `3` players per country
- Objective: maximize FantaLens Matchday 1 expected points (`xPts`)

## Browser Automation Notes

The FIFA site requires a FIFA account before saving the team. The safe flow is:

1. Build the recommended squad locally.
2. Open `https://play.fifa.com/fantasy/team`.
3. Let the user complete FIFA login if prompted.
4. Select each player from `data/recommended-squad.json`.
5. Stop before final `SAVE` if FIFA asks for a confirmation or if the visible squad differs from the generated squad.

The browser session already exposes player search/sort controls and `Add Player` buttons, so selection can be driven from the visible team-builder window after login.
