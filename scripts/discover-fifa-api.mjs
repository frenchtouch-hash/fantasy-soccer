import {
  FIFA_CONFIG,
  isJsonResponse,
  launchFifaContext,
  looksRelevantTeamPayload,
  summarizeHeaders,
  writeJson
} from "./lib/fifa-session.mjs";

const captures = [];
const { browser, context, page } = await launchFifaContext({ headless: true });

page.on("response", async (response) => {
  if (!isJsonResponse(response)) return;
  const url = response.url();
  if (!url.startsWith("https://")) return;

  try {
    const payload = await response.json();
    const relevant = looksRelevantTeamPayload(payload);
    captures.push({
      url,
      status: response.status(),
      method: response.request().method(),
      resourceType: response.request().resourceType(),
      headers: summarizeHeaders(response.request().headers()),
      relevant,
      observedAt: new Date().toISOString(),
      payloadPreview: relevant ? payload : undefined
    });
  } catch {
    // Ignore non-JSON bodies mislabeled by the server.
  }
});

await page.goto(FIFA_CONFIG.teamUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(12_000);

const candidates = captures.filter((entry) => entry.relevant);
const discovery = {
  generatedAt: new Date().toISOString(),
  teamUrl: FIFA_CONFIG.teamUrl,
  candidateCount: candidates.length,
  candidates: candidates.length ? candidates : captures.slice(0, 20)
};

await writeJson(FIFA_CONFIG.discoveryPath, discovery);
await context.close();
await browser.close();

console.log(`Saved FIFA API discovery to ${FIFA_CONFIG.discoveryPath}`);
if (!candidates.length) {
  console.log("No clearly relevant team JSON payload was detected. Review the discovery file and expand the heuristics if needed.");
} else {
  for (const candidate of candidates) {
    console.log(`- ${candidate.method} ${candidate.url}`);
  }
}
