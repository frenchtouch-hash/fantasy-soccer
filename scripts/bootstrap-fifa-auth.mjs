import readline from "node:readline/promises";
import { existsSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { FIFA_CONFIG, ensureParentDir } from "./lib/fifa-session.mjs";
import { chromium } from "playwright";

function detectBrowserChannel() {
  if (process.env.FIFA_BROWSER_CHANNEL) {
    return process.env.FIFA_BROWSER_CHANNEL;
  }

  const known = [
    { channel: "chrome", path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
    { channel: "msedge", path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" },
    { channel: "msedge", path: "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe" }
  ];

  for (const candidate of known) {
    if (existsSync(candidate.path)) {
      return candidate.channel;
    }
  }

  return undefined;
}

await ensureParentDir(FIFA_CONFIG.storageStatePath);
await ensureParentDir(FIFA_CONFIG.profileDir);

const browserChannel = detectBrowserChannel();
const context = await chromium.launchPersistentContext(FIFA_CONFIG.profileDir, {
  channel: browserChannel,
  headless: false,
  viewport: { width: 1440, height: 1100 },
  ignoreDefaultArgs: ["--enable-automation"]
});
context.setDefaultTimeout(45_000);

const page = context.pages()[0] ?? await context.newPage();
await page.goto(FIFA_CONFIG.teamUrl, { waitUntil: "domcontentloaded" });

console.log("A browser window is open on the FIFA fantasy team page.");
if (browserChannel) {
  console.log(`Using installed browser channel: ${browserChannel}`);
}
console.log("Log in manually if prompted, then confirm once your squad is visible.");

const rl = readline.createInterface({ input, output });
await rl.question("Press Enter after the squad page is fully loaded...");
rl.close();

await context.storageState({ path: FIFA_CONFIG.storageStatePath });
await context.close();

console.log(`Saved FIFA storage state to ${FIFA_CONFIG.storageStatePath}`);
