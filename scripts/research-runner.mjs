import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const findingsPath = path.join(root, "research", "findings", "screenshot-evidence.jsonl");
const statePath = path.join(root, "research", "findings", "capture-state.json");
const reportsRoot = path.join(root, "research", "reports");

const mode = process.argv[2] ?? "status";

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

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function markdownTable(rows) {
  if (!rows.length) return "_No evidence recorded yet._";
  return [
    "| Item | Count |",
    "| --- | ---: |",
    ...rows.map(([item, count]) => `| ${item || "unknown"} | ${count} |`),
  ].join("\n");
}

async function runCapture(limit = 5) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "capture-benchmarks.mjs"), `--limit=${limit}`], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  await ensureDir(path.join(root, "research", "logs"));
  await fs.writeFile(
    path.join(root, "research", "logs", `capture-${new Date().toISOString().replace(/[:.]/g, "-")}.log`),
    `${result.stdout}\n${result.stderr}`,
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Capture failed");
  }
  return result.stdout;
}

async function runCurrentSiteCrawl(limit = 40) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "crawl-current-site.mjs"), `--limit=${limit}`], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  await ensureDir(path.join(root, "research", "logs"));
  await fs.writeFile(
    path.join(root, "research", "logs", `current-crawl-${new Date().toISOString().replace(/[:.]/g, "-")}.log`),
    `${result.stdout}\n${result.stderr}`,
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Current-site crawl failed");
  }
  return result.stdout;
}

async function runIntelligence() {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "design-intelligence-cycle.mjs")], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  await ensureDir(path.join(root, "research", "logs"));
  await fs.writeFile(
    path.join(root, "research", "logs", `intelligence-${new Date().toISOString().replace(/[:.]/g, "-")}.log`),
    `${result.stdout}\n${result.stderr}`,
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Design intelligence generation failed");
  }
  return result.stdout;
}

async function generateStatus() {
  const state = await readJson(statePath, { capturedSites: {} });
  const records = await readJsonl(findingsPath);
  const currentInventory = await readJson(path.join(root, "research", "design-audits", "current-site-inventory.json"), {
    pageCount: 0,
  });
  const sites = Object.values(state.capturedSites ?? {});
  return {
    sitesCaptured: sites.length,
    currentSitePages: currentInventory.pageCount ?? 0,
    screenshotsAndRecords: records.length,
    categories: countBy(records, (record) => record.category ?? "unknown"),
    viewports: countBy(records, (record) => record.viewport ?? "unknown"),
    historicalErrors: records.filter((record) => record.type?.includes("error")).length,
    latestCaptureErrors: sites.reduce((sum, site) => sum + (site.errors ?? 0), 0),
    lastSites: sites.slice(-8),
  };
}

async function writeReport(kind) {
  const status = await generateStatus();
  await ensureDir(reportsRoot);
  const now = new Date();
  const filename = `${kind}-${now.toISOString().slice(0, 10)}-${now.toISOString().slice(11, 16).replace(":", "")}.md`;
  const outPath = path.join(reportsRoot, filename);
  const body = `# ${kind === "six-hour" ? "Six-Hour" : "Daily"} Design Intelligence Report

Generated: ${now.toISOString()}

## Evidence Coverage

- Sites captured: ${status.sitesCaptured}
- Current RTIH pages inventoried: ${status.currentSitePages}
- Screenshot/evidence records: ${status.screenshotsAndRecords}
- Latest capture errors: ${status.latestCaptureErrors}
- Historical capture errors: ${status.historicalErrors}

## Category Density

${markdownTable(status.categories)}

## Viewport Coverage

${markdownTable(status.viewports)}

## Current Interpretation

The evidence database is being populated before design recommendations are promoted from provisional to approved. The review focus remains:

- Founder path clarity.
- Institutional credibility without inflated claims.
- Ecosystem density without cognitive overload.
- Mobile-first navigation and CTA routing.
- Documentary image systems over generic startup imagery.
- Restraint in motion, color, and decorative effects.

## Required Comparative Lens

Every candidate pattern must still be compared against:

- Current RTIH implementation.
- Y Combinator implementation.
- Techstars implementation.
- Modern SaaS implementation.
- Government or institutional innovation implementation.

## Anti-Slop Review

No recommendation should pass unless it improves clarity, trust, usability, conversion, accessibility, and authenticity for RTIH.
`;
  await fs.writeFile(outPath, body);
  return outPath;
}

async function writeDailyGuidance() {
  const status = await generateStatus();
  const docs = [
    ["research/brand-system/brand-strategy.md", "Brand Strategy Document"],
    ["research/ux-principles/ux-strategy.md", "UX Strategy Document"],
    ["research/navigation-research/information-architecture-map.md", "Information Architecture Map"],
    ["research/ux-principles/user-journey-maps.md", "User Journey Maps"],
    ["research/ux-principles/founder-journey-map.md", "Founder Journey Map"],
    ["research/ux-principles/partner-journey-map.md", "Partner Journey Map"],
    ["research/ux-principles/event-attendee-journey-map.md", "Event Attendee Journey Map"],
    ["research/typography-research/typography-system.md", "Typography System"],
    ["research/style-guide/color-system.md", "Color System"],
    ["research/style-guide/grid-system.md", "Grid System"],
    ["research/motion-research/motion-principles.md", "Motion Principles"],
    ["research/style-guide/photography-guidelines.md", "Photography Guidelines"],
    ["research/style-guide/video-guidelines.md", "Video Guidelines"],
    ["research/style-guide/iconography-system.md", "Iconography System"],
    ["research/cta-research/cta-system.md", "CTA System"],
    ["research/style-guide/spacing-system.md", "Spacing System"],
    ["research/accessibility-audits/accessibility-system.md", "Accessibility System"],
    ["research/mobile-research/mobile-first-rules.md", "Mobile-First Rules"],
    ["research/mobile-research/responsive-behavior-guide.md", "Responsive Behavior Guide"],
    ["research/navigation-research/navigation-system.md", "Navigation System"],
    ["research/brand-system/homepage-storytelling-framework.md", "Homepage Storytelling Framework"],
    ["research/brand-system/content-hierarchy-rules.md", "Content Hierarchy Rules"],
    ["research/component-library/card-component-systems.md", "Card Component Systems"],
    ["research/component-library/section-library.md", "Section Library"],
    ["research/ux-principles/interaction-principles.md", "Interaction Principles"],
    ["research/brand-system/trust-building-framework.md", "Trust-Building Framework"],
    ["research/brand-system/institutional-credibility-framework.md", "Institutional Credibility Framework"],
    ["research/brand-system/ecosystem-storytelling-framework.md", "Ecosystem Storytelling Framework"],
    ["research/cta-research/founder-conversion-framework.md", "Founder Conversion Framework"],
    ["research/brand-system/event-storytelling-framework.md", "Event Storytelling Framework"],
  ];

  const body = (title) => `# ${title}

Status: Provisional research artifact.
Last updated: ${new Date().toISOString()}
Evidence records available: ${status.screenshotsAndRecords}
Sites captured: ${status.sitesCaptured}

## Purpose

This document is part of the required pre-development design strategy set for the RTIH redesign. It must be validated against screenshot evidence, current RTIH content, global accelerator benchmarks, Indian institutional benchmarks, and modern product-site benchmarks before approval.

## Current Direction

- Communicate RTIH as a credible, founder-centric innovation ecosystem in Visakhapatnam and Andhra Pradesh.
- Preserve institutional trust while making founder paths clearer and faster.
- Show ecosystem activity through real programs, people, events, partners, and startup stories.
- Avoid fake metrics, generic startup imagery, trend-led decoration, over-animation, and inflated Silicon Valley imitation.
- Prioritize mobile readability, accessible contrast, durable typography, and clear CTA routing.

## Evidence Required Before Approval

- Relevant screenshots from current RTIH.
- At least one global accelerator comparison.
- At least one Indian incubator or government ecosystem comparison.
- At least one modern startup/SaaS comparison where useful.
- Pros, cons, applicability to RTIH, implementation complexity, and risk analysis.

## Approval Questions

1. Is this authentic to RTIH?
2. Does it improve founder trust and institutional credibility?
3. Does it improve clarity, usability, navigation, and conversion?
4. Is it evidence-based rather than fashionable decoration?
5. Is it accessible, mobile-first, scalable, and likely to age well?
`;

  for (const [relative, title] of docs) {
    const file = path.join(root, relative);
    await ensureDir(path.dirname(file));
    try {
      await fs.access(file);
    } catch {
      await fs.writeFile(file, body(title));
    }
  }
}

async function updateStatusFile() {
  const status = await generateStatus();
  const outPath = path.join(root, "research", "RESEARCH_STATUS.md");
  const body = `# Research Status

Status: Active research operation.
Last updated: ${new Date().toISOString()}

## Evidence Coverage

- Sites captured: ${status.sitesCaptured}
- Current RTIH pages inventoried: ${status.currentSitePages}
- Screenshot/evidence records: ${status.screenshotsAndRecords}
- Latest capture errors: ${status.latestCaptureErrors}
- Historical capture errors: ${status.historicalErrors}

## Current Gates

- Screenshot benchmark database: In progress.
- Current RTIH audit: Not complete.
- Benchmark analysis: Not complete.
- Style guide approval: Not requested yet.
- UX principles approval: Not requested yet.
- Architecture approval: Not requested yet.
- Anti-slop review: Not complete.
- Frontend development: Locked.

## Category Density

${markdownTable(status.categories)}

## Decision Standard

Recommendations are provisional until supported by screenshots, pattern comparison, risk analysis, and applicability analysis for RTIH.
`;
  await fs.writeFile(outPath, body);
}

async function main() {
  if (mode === "hourly") {
    const output = await runCapture(5);
    const crawlOutput = await runCurrentSiteCrawl(40);
    const intelligenceOutput = await runIntelligence();
    await writeReport("hourly");
    await updateStatusFile();
    console.log(output);
    console.log(crawlOutput);
    console.log(intelligenceOutput);
    console.log("Hourly research cycle complete.");
    return;
  }

  if (mode === "six-hour") {
    await runIntelligence();
    const report = await writeReport("six-hour");
    await updateStatusFile();
    console.log(`Report written: ${path.relative(root, report)}`);
    return;
  }

  if (mode === "daily") {
    await runCurrentSiteCrawl(40);
    await runIntelligence();
    await writeDailyGuidance();
    const report = await writeReport("daily");
    await updateStatusFile();
    console.log(`Daily guidance refreshed. Report written: ${path.relative(root, report)}`);
    return;
  }

  if (mode === "audit") {
    await updateStatusFile();
    const report = await writeReport("six-hour");
    console.log(`Audit checkpoint written: ${path.relative(root, report)}`);
    return;
  }

  const status = await generateStatus();
  await updateStatusFile();
  console.log(JSON.stringify(status, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
