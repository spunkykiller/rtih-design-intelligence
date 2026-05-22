import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "research", "config", "benchmarks.json");
const findingsPath = path.join(root, "research", "findings", "screenshot-evidence.jsonl");
const statePath = path.join(root, "research", "findings", "capture-state.json");
const screenshotsRoot = path.join(root, "research", "screenshots");
const auditsRoot = path.join(root, "research", "accessibility-audits");

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

const limit = Number(args.get("limit") ?? 3);
const onlySlug = args.get("site");
const force = args.has("force");

const sectionSelector = [
  "header",
  "nav",
  "main > section",
  "section",
  "article",
  "aside",
  "footer",
  "[class*='hero' i]",
  "[class*='partner' i]",
  "[class*='portfolio' i]",
  "[class*='startup' i]",
  "[class*='event' i]",
  "[class*='program' i]",
  "[class*='testimonial' i]",
  "[class*='cta' i]",
].join(", ");

const categoryRules = [
  ["navigation", /\b(nav|menu|header|explore|resources|about|programs)\b/i],
  ["hero-sections", /\b(hero|headline|welcome|build|founder|startup|accelerator|incubator)\b/i],
  ["cta-systems", /\b(apply|join|start|get started|contact|register|submit|book|learn more)\b/i],
  ["startup-showcase", /\b(startups|portfolio|companies|founders|alumni|venture|cohort)\b/i],
  ["event-systems", /\b(events|workshop|summit|demo day|calendar|webinar|meetup)\b/i],
  ["ecosystem-maps", /\b(ecosystem|network|community|hub|campus|map|locations)\b/i],
  ["partner-layouts", /\b(partner|sponsor|corporate|university|government|logo)\b/i],
  ["institutional-trust", /\b(research|impact|report|board|trustees|government|university|about|mission|team)\b/i],
  ["application-funnels", /\b(apply|application|eligibility|deadline|program|cohort|selection)\b/i],
  ["typography", /\b(title|headline|story|insight|article|blog|news)\b/i],
  ["image-systems", /\b(image|gallery|photo|media|video|story)\b/i],
  ["mobile-ux", /\b(mobile|menu|drawer)\b/i],
  ["grid-systems", /\b(grid|cards|list|columns|tiles)\b/i],
  ["motion-inspiration", /\b(animation|motion|video|interactive|scroll)\b/i],
];

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function classifySection({ selector, id, className, text }) {
  const haystack = `${selector ?? ""} ${id ?? ""} ${className ?? ""} ${text ?? ""}`.slice(0, 2400);
  for (const [category, rule] of categoryRules) {
    if (rule.test(haystack)) return category;
  }
  return "grid-systems";
}

async function appendEvidence(records) {
  if (!records.length) return;
  await ensureDir(path.dirname(findingsPath));
  const body = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  await fs.appendFile(findingsPath, body, "utf8");
}

async function acceptCookieBanners(page) {
  const candidates = [
    "Accept all",
    "Accept All",
    "Accept",
    "I agree",
    "Agree",
    "Allow all",
    "Got it",
    "OK",
  ];
  for (const name of candidates) {
    try {
      const button = page.getByRole("button", { name, exact: true });
      if ((await button.count()) === 1 && (await button.isVisible())) {
        await button.click({ timeout: 1500 });
        return;
      }
    } catch {
      // Cookie banners vary wildly; ignore failures and keep capture moving.
    }
  }
}

async function collectPageSignature(page) {
  return page.evaluate(() => {
    const text = (node) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
    const fontFamilies = new Set();
    const colors = new Set();
    const backgroundColors = new Set();
    const headingScale = [];
    document.querySelectorAll("body, h1, h2, h3, h4, p, a, button, nav, section").forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.fontFamily) fontFamilies.add(style.fontFamily);
      if (style.color) colors.add(style.color);
      if (style.backgroundColor && style.backgroundColor !== "rgba(0, 0, 0, 0)") {
        backgroundColors.add(style.backgroundColor);
      }
    });
    document.querySelectorAll("h1, h2, h3").forEach((el) => {
      const style = window.getComputedStyle(el);
      headingScale.push({
        tag: el.tagName.toLowerCase(),
        text: text(el).slice(0, 160),
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
      });
    });
    const links = Array.from(document.querySelectorAll("a[href]"))
      .slice(0, 80)
      .map((a) => ({ text: text(a).slice(0, 120), href: a.href }));
    return {
      title: document.title,
      finalUrl: location.href,
      language: document.documentElement.lang || null,
      fontFamilies: Array.from(fontFamilies).slice(0, 20),
      colors: Array.from(colors).slice(0, 24),
      backgroundColors: Array.from(backgroundColors).slice(0, 24),
      headingScale: headingScale.slice(0, 24),
      links,
    };
  });
}

async function collectSections(page) {
  return page.evaluate((selector) => {
    const sections = [];
    const seen = new Set();
    document.querySelectorAll(selector).forEach((el, index) => {
      const rect = el.getBoundingClientRect();
      const pageY = rect.top + window.scrollY;
      const pageX = rect.left + window.scrollX;
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width < 240 || height < 80) return;
      el.setAttribute("data-rtih-section-index", String(index));
      const key = `${Math.round(pageY)}-${width}-${height}`;
      if (seen.has(key)) return;
      seen.add(key);
      const label =
        el.getAttribute("aria-label") ||
        el.querySelector("h1,h2,h3")?.textContent ||
        el.textContent ||
        el.tagName;
      sections.push({
        index,
        tag: el.tagName.toLowerCase(),
        id: el.id || "",
        className: typeof el.className === "string" ? el.className : "",
        label: label.replace(/\s+/g, " ").trim().slice(0, 180),
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 1200),
        rect: {
          x: Math.max(0, Math.round(pageX)),
          y: Math.max(0, Math.round(pageY)),
          width,
          height,
        },
      });
    });
    return sections
      .sort((a, b) => a.rect.y - b.rect.y)
      .slice(0, 36);
  }, sectionSelector);
}

async function screenshotClip(page, outPath, rect, viewport) {
  const documentSize = await page.evaluate(() => ({
    width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  }));
  const x = Math.max(0, Math.min(rect.x, documentSize.width - 1));
  const y = Math.max(0, Math.min(rect.y, documentSize.height - 1));
  const availableWidth = documentSize.width - x;
  const availableHeight = documentSize.height - y;
  if (availableWidth <= 1 || availableHeight <= 1) {
    throw new Error(`Section clip outside document bounds: ${JSON.stringify({ rect, documentSize })}`);
  }
  const clip = {
    x,
    y,
    width: Math.max(1, Math.min(rect.width, viewport.width, availableWidth)),
    height: Math.max(1, Math.min(rect.height, 2200, availableHeight)),
  };
  await page.screenshot({ path: outPath, clip, animations: "disabled" });
}

async function captureHoverStates(page, site, viewportName, siteDir, viewport) {
  const records = [];
  if (viewportName !== "desktop") return records;

  const groups = [
    {
      label: "navigation",
      locator: "header a[href], nav a[href], header button, nav button",
      max: 6,
    },
    {
      label: "cta-systems",
      locator:
        "a:has-text('Apply'), a:has-text('Join'), a:has-text('Get started'), a:has-text('Contact'), a:has-text('Register'), button:has-text('Apply'), button:has-text('Join'), button:has-text('Contact'), button:has-text('Register')",
      max: 6,
    },
  ];

  for (const group of groups) {
    let count = 0;
    try {
      count = Math.min(await page.locator(group.locator).count(), group.max);
    } catch {
      continue;
    }

    for (let i = 0; i < count; i += 1) {
      try {
        const locator = page.locator(group.locator).nth(i);
        const label = (await locator.innerText({ timeout: 1000 })).replace(/\s+/g, " ").trim().slice(0, 80);
        if (!label && group.label === "cta-systems") continue;
        await locator.hover({ timeout: 2500 });
        const filename = `${String(i + 1).padStart(2, "0")}-${slugify(label || group.label)}-hover.png`;
        const outPath = path.join(siteDir, viewportName, group.label, filename);
        await ensureDir(path.dirname(outPath));
        await page.screenshot({ path: outPath, fullPage: false, animations: "disabled" });
        records.push({
          type: "state",
          state: "hover",
          category: group.label,
          site: site.slug,
          viewport: viewportName,
          label,
          screenshot: path.relative(root, outPath),
          capturedAt: new Date().toISOString(),
        });
      } catch {
        // Hover affordances are non-critical evidence; move on.
      }
    }
  }

  return records;
}

async function captureMobileMenu(page, site, siteDir) {
  const records = [];
  const candidates = [
    "button[aria-label*='menu' i]",
    "button[aria-expanded='false']",
    "button:has-text('Menu')",
    "[role='button'][aria-label*='menu' i]",
  ];

  for (const selector of candidates) {
    try {
      const button = page.locator(selector).first();
      if ((await button.count()) < 1 || !(await button.isVisible())) continue;
      await button.click({ timeout: 2500 });
      const outPath = path.join(siteDir, "mobile", "navigation", "mobile-menu-open.png");
      await ensureDir(path.dirname(outPath));
      await page.screenshot({ path: outPath, fullPage: false, animations: "disabled" });
      records.push({
        type: "state",
        state: "mobile-menu-open",
        category: "navigation",
        site: site.slug,
        viewport: "mobile",
        screenshot: path.relative(root, outPath),
        capturedAt: new Date().toISOString(),
      });
      break;
    } catch {
      // Continue to next common menu selector.
    }
  }

  return records;
}

async function captureApplicationTargets(page, context, site, siteDir) {
  const records = [];
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"))
      .map((a) => ({
        text: (a.textContent || "").replace(/\s+/g, " ").trim(),
        href: a.href,
      }))
      .filter((link) => /\b(apply|application|join|register|program|cohort|contact)\b/i.test(`${link.text} ${link.href}`))
      .slice(0, 4),
  );

  for (let i = 0; i < links.length; i += 1) {
    const link = links[i];
    try {
      const target = await context.newPage();
      await target.setViewportSize({ width: 1440, height: 1000 });
      await target.goto(link.href, { waitUntil: "domcontentloaded", timeout: 45000 });
      await target.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await acceptCookieBanners(target);
      const filename = `${String(i + 1).padStart(2, "0")}-${slugify(link.text || link.href)}.png`;
      const outPath = path.join(siteDir, "desktop", "application-funnels", filename);
      await ensureDir(path.dirname(outPath));
      await target.screenshot({ path: outPath, fullPage: true, animations: "disabled" });
      records.push({
        type: "linked-flow",
        category: "application-funnels",
        site: site.slug,
        viewport: "desktop",
        label: link.text,
        href: link.href,
        screenshot: path.relative(root, outPath),
        capturedAt: new Date().toISOString(),
      });
      await target.close();
    } catch (error) {
      records.push({
        type: "capture-error",
        category: "application-funnels",
        site: site.slug,
        label: link.text,
        href: link.href,
        error: error.message,
        capturedAt: new Date().toISOString(),
      });
    }
  }

  return records;
}

async function captureAccessibility(page, site, viewportName) {
  if (viewportName !== "desktop") return null;
  try {
    const results = await new AxeBuilder({ page }).analyze();
    const outPath = path.join(auditsRoot, `${site.slug}.axe.json`);
    await ensureDir(path.dirname(outPath));
    await fs.writeFile(outPath, JSON.stringify(results, null, 2));
    return {
      type: "accessibility-audit",
      category: "institutional-trust",
      site: site.slug,
      viewport: viewportName,
      violations: results.violations.length,
      incomplete: results.incomplete.length,
      passes: results.passes.length,
      audit: path.relative(root, outPath),
      capturedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      type: "accessibility-error",
      category: "institutional-trust",
      site: site.slug,
      viewport: viewportName,
      error: error.message,
      capturedAt: new Date().toISOString(),
    };
  }
}

async function captureSite(browser, site, viewports) {
  const siteDir = path.join(screenshotsRoot, site.slug);
  const records = [];
  const metadata = {
    site,
    capturedAt: new Date().toISOString(),
    viewports: {},
  };

  for (const [viewportName, viewport] of Object.entries(viewports)) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      colorScheme: "light",
      locale: "en-US",
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36 RTIHDesignResearch/0.1",
    });
    const page = await context.newPage();

    try {
      await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
      await acceptCookieBanners(page);

      const signature = await collectPageSignature(page);
      metadata.viewports[viewportName] = signature;

      const fullPath = path.join(siteDir, viewportName, "full-page", "full-page.png");
      const heroPath = path.join(siteDir, viewportName, "hero-sections", "initial-viewport.png");
      await ensureDir(path.dirname(fullPath));
      await ensureDir(path.dirname(heroPath));
      await page.screenshot({ path: fullPath, fullPage: true, animations: "disabled" });
      await page.screenshot({ path: heroPath, fullPage: false, animations: "disabled" });

      records.push(
        {
          type: "full-page",
          category: "grid-systems",
          site: site.slug,
          siteName: site.name,
          url: site.url,
          viewport: viewportName,
          screenshot: path.relative(root, fullPath),
          capturedAt: new Date().toISOString(),
        },
        {
          type: "viewport",
          category: "hero-sections",
          site: site.slug,
          siteName: site.name,
          url: site.url,
          viewport: viewportName,
          screenshot: path.relative(root, heroPath),
          capturedAt: new Date().toISOString(),
        },
      );

      const sections = await collectSections(page);
      metadata.viewports[viewportName].sections = [];
      for (let i = 0; i < sections.length; i += 1) {
        const section = sections[i];
        const category = classifySection(section);
        const filename = `${String(i + 1).padStart(2, "0")}-${slugify(section.label || section.tag)}.png`;
        const outPath = path.join(siteDir, viewportName, category, filename);
        try {
          await ensureDir(path.dirname(outPath));
          const sectionLocator = page.locator(`[data-rtih-section-index="${section.index}"]`);
          if ((await sectionLocator.count()) === 1) {
            await sectionLocator.screenshot({ path: outPath, animations: "disabled", timeout: 5000 });
          } else {
            await screenshotClip(page, outPath, section.rect, viewport);
          }
          metadata.viewports[viewportName].sections.push({ ...section, category, screenshot: path.relative(root, outPath) });
          records.push({
            type: "section",
            category,
            site: site.slug,
            siteName: site.name,
            url: site.url,
            viewport: viewportName,
            label: section.label,
            textSample: section.text.slice(0, 300),
            screenshot: path.relative(root, outPath),
            capturedAt: new Date().toISOString(),
          });
        } catch (error) {
          records.push({
            type: "capture-error",
            category,
            site: site.slug,
            viewport: viewportName,
            label: section.label,
            error: error.message,
            capturedAt: new Date().toISOString(),
          });
        }
      }

      records.push(...(await captureHoverStates(page, site, viewportName, siteDir, viewport)));
      if (viewportName === "mobile") {
        records.push(...(await captureMobileMenu(page, site, siteDir)));
      }
      if (viewportName === "desktop") {
        const accessibilityRecord = await captureAccessibility(page, site, viewportName);
        if (accessibilityRecord) records.push(accessibilityRecord);
        records.push(...(await captureApplicationTargets(page, context, site, siteDir)));
      }
    } catch (error) {
      records.push({
        type: "site-error",
        category: "institutional-trust",
        site: site.slug,
        siteName: site.name,
        url: site.url,
        viewport: viewportName,
        error: error.message,
        capturedAt: new Date().toISOString(),
      });
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }

  const metadataPath = path.join(root, "research", "benchmark-analysis", `${site.slug}.metadata.json`);
  await ensureDir(path.dirname(metadataPath));
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  await appendEvidence(records);
  return records;
}

async function main() {
  const config = await readJson(configPath, null);
  if (!config) throw new Error(`Missing config at ${configPath}`);
  const state = await readJson(statePath, { capturedSites: {} });

  const sites = [config.project.currentSite, ...config.benchmarks]
    .filter(Boolean)
    .filter((site) => !onlySlug || site.slug === onlySlug)
    .filter((site) => force || !state.capturedSites[site.slug])
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999) || a.slug.localeCompare(b.slug))
    .slice(0, limit);

  if (!sites.length) {
    console.log("No matching benchmark sites to capture.");
    return;
  }

  await ensureDir(screenshotsRoot);
  await ensureDir(path.dirname(statePath));
  const browser = await chromium.launch({ headless: true });

  try {
    for (const site of sites) {
      console.log(`Capturing ${site.name} (${site.url})`);
      const records = await captureSite(browser, site, config.viewports);
      const errors = records.filter((record) => record.type?.includes("error")).length;
      state.capturedSites[site.slug] = {
        name: site.name,
        url: site.url,
        category: site.category,
        lastCapturedAt: new Date().toISOString(),
        records: records.length,
        errors,
      };
      await fs.writeFile(statePath, JSON.stringify(state, null, 2));
    }
  } finally {
    await browser.close();
  }

  console.log(`Captured ${sites.length} site(s). Evidence: ${path.relative(root, findingsPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
