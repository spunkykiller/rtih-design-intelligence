import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const configPath = path.join(root, "research", "config", "benchmarks.json");
const statePath = path.join(root, "research", "findings", "capture-state.json");
const evidencePath = path.join(root, "research", "findings", "screenshot-evidence.jsonl");
const currentInventoryPath = path.join(root, "research", "design-audits", "current-site-inventory.json");
const patternJsonPath = path.join(root, "research", "pattern-library", "pattern-scores.json");
const patternMdPath = path.join(root, "research", "pattern-library", "PATTERN_LIBRARY.md");
const antiPatternMdPath = path.join(root, "research", "anti-pattern-library", "ANTI_PATTERN_LIBRARY.md");
const decisionLogPath = path.join(root, "research", "decision-logs", "DECISIONS.md");
const rationaleLogPath = path.join(root, "research", "rationale-logs", "RATIONALE.md");

const criteria = [
  "clarity",
  "trust",
  "usability",
  "conversion",
  "ecosystemStorytelling",
  "scalability",
  "mobileQuality",
  "accessibility",
  "visualRestraint",
  "originality",
];

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function readJsonl(file) {
  try {
    const body = await fs.readFile(file, "utf8");
    return body
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function ensureDir(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
}

function clamp(score) {
  return Math.max(1, Math.min(5, Math.round(score)));
}

function hasAny(text, words) {
  return words.some((word) => new RegExp(`\\b${word}\\b`, "i").test(text));
}

function countAny(text, words) {
  return words.reduce((sum, word) => sum + (new RegExp(`\\b${word}\\b`, "ig").exec(text) ? 1 : 0), 0);
}

function latestRecordsBySite(records) {
  const grouped = new Map();
  for (const record of records) {
    if (!record.site) continue;
    if (!grouped.has(record.site)) grouped.set(record.site, []);
    grouped.get(record.site).push(record);
  }
  return grouped;
}

function scoreSite({ site, metadata, records, axe }) {
  const desktop = metadata?.viewports?.desktop ?? {};
  const mobile = metadata?.viewports?.mobile ?? {};
  const allHeadings = [
    ...(desktop.headingScale ?? []),
    ...(mobile.headingScale ?? []),
  ];
  const links = desktop.links ?? [];
  const sections = desktop.sections ?? [];
  const text = JSON.stringify({ headings: allHeadings, links, sections, focus: site.focus ?? [] });
  const ctaLinks = links.filter((link) =>
    /\b(apply|join|contact|register|start|get started|submit|book|program)\b/i.test(`${link.text} ${link.href}`),
  );
  const navLinks = links.filter((link) => link.text && link.text.length < 42).slice(0, 16);
  const colors = desktop.colors?.length ?? 0;
  const backgrounds = desktop.backgroundColors?.length ?? 0;
  const fonts = desktop.fontFamilies?.length ?? 0;
  const evidenceScreenshots = records.filter((record) => record.screenshot);
  const mobileEvidence = records.filter((record) => record.viewport === "mobile" && record.screenshot);
  const errors = records.filter((record) => String(record.type).includes("error")).length;
  const violations = axe?.violations?.length ?? null;

  const scores = {
    clarity: clamp(2 + Math.min(allHeadings.length, 10) / 4 + (allHeadings.some((h) => h.tag === "h1" && h.text) ? 1 : 0)),
    trust: clamp(2 + countAny(text, ["about", "team", "mentor", "partner", "portfolio", "research", "government", "university", "impact", "report"])),
    usability: clamp(2 + Math.min(navLinks.length, 10) / 3 + Math.min(sections.length, 12) / 6 - errors / 20),
    conversion: clamp(1 + Math.min(ctaLinks.length, 8) / 2),
    ecosystemStorytelling: clamp(
      1 +
        countAny(text, ["ecosystem", "community", "partner", "mentor", "startup", "founder", "event", "program", "location", "sector"]) /
          2,
    ),
    scalability: clamp(2 + Math.min(sections.length, 16) / 5 + Math.min(evidenceScreenshots.length, 60) / 25),
    mobileQuality: clamp(2 + Math.min(mobileEvidence.length, 20) / 5 - records.filter((r) => r.viewport === "mobile" && String(r.type).includes("error")).length / 8),
    accessibility: violations == null ? 3 : clamp(5 - violations / 4),
    visualRestraint: clamp(5 - Math.max(0, colors + backgrounds - 28) / 6 - Math.max(0, fonts - 8) / 2),
    originality: clamp(
      2 +
        countAny(text, ["deep", "research", "science", "hardware", "community", "campus", "sector", "venture", "prototype", "public"]) /
          3 -
        countAny(text, ["disrupt", "revolution", "future-proof", "unlock", "transform"]) /
          4,
    ),
  };

  const average =
    criteria.reduce((sum, key) => sum + scores[key], 0) / criteria.length;

  const strengths = [];
  if (scores.clarity >= 4) strengths.push("clear hierarchy");
  if (scores.conversion >= 4) strengths.push("visible conversion paths");
  if (scores.ecosystemStorytelling >= 4) strengths.push("strong ecosystem language");
  if (scores.visualRestraint >= 4) strengths.push("restrained visual system");
  if (scores.accessibility >= 4) strengths.push("low automated accessibility issue count");

  const risks = [];
  if (scores.conversion <= 2) risks.push("weak or diffuse CTA routing");
  if (scores.visualRestraint <= 2) risks.push("possible visual overload");
  if (scores.mobileQuality <= 2) risks.push("mobile evidence needs review");
  if (scores.accessibility <= 2) risks.push("automated accessibility concerns");
  if (hasAny(text, ["unicorn", "soonicorn", "disrupt", "revolution"])) risks.push("watch for credibility inflation or startup cliché language");

  return {
    site: site.slug,
    name: site.name,
    url: site.url,
    category: site.category,
    focus: site.focus ?? [],
    scores,
    average: Number(average.toFixed(2)),
    strengths,
    risks,
    evidence: {
      screenshots: evidenceScreenshots.length,
      desktopSections: sections.length,
      mobileScreenshots: mobileEvidence.length,
      ctaLinks: ctaLinks.slice(0, 8),
      navLinks: navLinks.slice(0, 12),
      axeViolations: violations,
      metadata: `research/benchmark-analysis/${site.slug}.metadata.json`,
    },
    fitForRtih:
      average >= 4
        ? "Strong candidate for deeper RTIH comparison."
        : average >= 3
          ? "Useful with selective adaptation and anti-slop review."
          : "Do not adopt without strong strategic reason.",
  };
}

async function loadAxe(slug) {
  return readJson(path.join(root, "research", "accessibility-audits", `${slug}.axe.json`), null);
}

function scoreTable(scorecards) {
  return [
    "| Site | Avg | Clarity | Trust | UX | Conv. | Ecosystem | Mobile | A11y | Restraint | Fit |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...scorecards.map((card) => {
      const s = card.scores;
      return `| ${card.name} | ${card.average} | ${s.clarity} | ${s.trust} | ${s.usability} | ${s.conversion} | ${s.ecosystemStorytelling} | ${s.mobileQuality} | ${s.accessibility} | ${s.visualRestraint} | ${card.fitForRtih} |`;
    }),
  ].join("\n");
}

function patternCandidates(scorecards) {
  const patterns = [];
  for (const card of scorecards) {
    if (card.scores.conversion >= 4) {
      patterns.push({
        pattern: "Visible application or contact path",
        source: card.name,
        category: "cta-systems",
        score: card.scores.conversion,
        applicability: "Useful for RTIH only when routed by user type: founder, student, researcher, partner, mentor, investor, event attendee.",
        risk: "A generic Apply button can collapse different journeys into one confusing path.",
      });
    }
    if (card.scores.ecosystemStorytelling >= 4) {
      patterns.push({
        pattern: "Ecosystem-first narrative density",
        source: card.name,
        category: "ecosystem-storytelling",
        score: card.scores.ecosystemStorytelling,
        applicability: "High relevance to RTIH because hub-and-spoke, universities, government, startups, mentors, and regional sectors need a shared map.",
        risk: "Can become jargon if not grounded in real programs, locations, events, and people.",
      });
    }
    if (card.scores.visualRestraint >= 4 && card.scores.clarity >= 4) {
      patterns.push({
        pattern: "Restrained editorial hierarchy",
        source: card.name,
        category: "typography",
        score: Math.min(card.scores.visualRestraint, card.scores.clarity),
        applicability: "Strong fit for RTIH institutional content, long program explanations, and founder stories.",
        risk: "If too austere, the site can feel inactive unless paired with real event and founder imagery.",
      });
    }
  }
  return patterns.slice(0, 24);
}

function antiPatterns(scorecards) {
  const items = [];
  for (const card of scorecards) {
    for (const risk of card.risks) {
      items.push({
        antiPattern: risk,
        source: card.name,
        category: card.category,
        rejectionStandard:
          "Reject for RTIH unless it measurably improves clarity, trust, usability, conversion, accessibility, and authenticity.",
      });
    }
  }
  return items.slice(0, 32);
}

async function maybeCapture() {
  const shouldCapture = process.argv.includes("--capture");
  if (!shouldCapture) return "";
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "capture-benchmarks.mjs"), "--limit=5"], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Capture failed");
  return result.stdout;
}

async function main() {
  const captureOutput = await maybeCapture();
  const config = await readJson(configPath, null);
  const state = await readJson(statePath, { capturedSites: {} });
  const currentInventory = await readJson(currentInventoryPath, { pageCount: 0 });
  const records = await readJsonl(evidencePath);
  const recordsBySite = latestRecordsBySite(records);

  const sites = [config.project.currentSite, ...config.benchmarks].filter((site) => state.capturedSites?.[site.slug]);
  const scorecards = [];

  for (const site of sites) {
    const metadata = await readJson(path.join(root, "research", "benchmark-analysis", `${site.slug}.metadata.json`), {});
    const axe = await loadAxe(site.slug);
    scorecards.push(scoreSite({ site, metadata, records: recordsBySite.get(site.slug) ?? [], axe }));
  }

  scorecards.sort((a, b) => b.average - a.average || a.name.localeCompare(b.name));
  const patterns = patternCandidates(scorecards);
  const anti = antiPatterns(scorecards);
  const now = new Date().toISOString();

  await ensureDir(patternJsonPath);
  await fs.writeFile(patternJsonPath, JSON.stringify({ generatedAt: now, scorecards, patterns, antiPatterns: anti }, null, 2));

  await fs.writeFile(
    patternMdPath,
    `# Pattern Library

Generated: ${now}

This is a strategic pattern library, not a visual imitation board. Scores are provisional and must be validated by human review of screenshots before design approval.

## Scoreboard

${scoreTable(scorecards)}

## Candidate Patterns

${patterns
  .map(
    (item) => `### ${item.pattern}

- Source: ${item.source}
- Category: ${item.category}
- Score signal: ${item.score}/5
- Applicability to RTIH: ${item.applicability}
- Risk: ${item.risk}`,
  )
  .join("\n\n")}
`,
  );

  await fs.writeFile(
    antiPatternMdPath,
    `# Anti-Pattern Library

Generated: ${now}

These are rejection prompts for RTIH. They identify where patterns can become inauthentic, overdesigned, inaccessible, or strategically weak.

${anti
  .map(
    (item) => `## ${item.antiPattern}

- Observed source: ${item.source}
- Source category: ${item.category}
- Rejection standard: ${item.rejectionStandard}`,
  )
  .join("\n\n")}
`,
  );

  const decisionEntry = `\n## ${now} Continuous Intelligence Cycle\n\n- Captured sites available: ${scorecards.length}\n- Current RTIH pages inventoried: ${currentInventory.pageCount ?? 0}\n- Strongest current signals: ${scorecards.slice(0, 3).map((card) => `${card.name} (${card.average})`).join(", ")}\n- Decision: keep recommendations provisional; promote only screenshot-backed, comparison-tested patterns.\n- Development status: locked.\n`;
  await fs.appendFile(decisionLogPath, decisionEntry);

  const rationaleEntry = `\n## ${now} Rationale\n\nThe operation now scores benchmark evidence across clarity, trust, usability, conversion, ecosystem storytelling, scalability, mobile quality, accessibility, visual restraint, and originality. RTIH should borrow structural intelligence only: CTA routing, hierarchy, trust systems, journey clarity, and ecosystem mapping. It should reject surface imitation, fake metrics, generic founder imagery, and visual effects without communication value.\n`;
  await fs.appendFile(rationaleLogPath, rationaleEntry);

  console.log(captureOutput);
  console.log(`Design intelligence generated for ${scorecards.length} captured site(s).`);
  console.log(`Pattern library: ${path.relative(root, patternMdPath)}`);
  console.log(`Anti-pattern library: ${path.relative(root, antiPatternMdPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
