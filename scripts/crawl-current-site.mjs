import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "research", "config", "benchmarks.json");
const outPath = path.join(root, "research", "design-audits", "current-site-inventory.json");
const evidencePath = path.join(root, "research", "findings", "current-site-evidence.jsonl");
const screenshotsRoot = path.join(root, "research", "screenshots", "rtih-current-site-map");

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);
const limit = Number(args.get("limit") ?? 40);

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
  const url = new URL(input);
  const pathname = url.pathname === "/" ? "home" : url.pathname;
  return pathname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function normalizeUrl(href, base) {
  try {
    const url = new URL(href, base);
    url.hash = "";
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString().replace(/\/$/, "/");
  } catch {
    return null;
  }
}

function isSameSite(url, base) {
  return new URL(url).origin === new URL(base).origin;
}

function shouldSkip(url) {
  return /\.(pdf|zip|jpg|jpeg|png|gif|webp|svg|mp4|mov|docx?|xlsx?)$/i.test(new URL(url).pathname);
}

async function collectPageInventory(page) {
  return page.evaluate(() => {
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4"))
      .map((el) => ({
        level: el.tagName.toLowerCase(),
        text: clean(el.textContent).slice(0, 220),
      }))
      .filter((item) => item.text);
    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => ({
        text: clean(a.textContent).slice(0, 160),
        href: a.href,
      }))
      .filter((item) => item.href);
    const sections = Array.from(document.querySelectorAll("header, nav, main > section, section, article, aside, footer"))
      .map((el, index) => ({
        index,
        tag: el.tagName.toLowerCase(),
        label: clean(el.querySelector("h1,h2,h3,h4")?.textContent || el.getAttribute("aria-label") || el.textContent).slice(0, 220),
        textSample: clean(el.textContent).slice(0, 800),
      }))
      .filter((item) => item.label || item.textSample);
    return {
      title: document.title,
      finalUrl: location.href,
      headings,
      links,
      sections,
      wordCount: clean(document.body?.innerText).split(/\s+/).filter(Boolean).length,
    };
  });
}

async function main() {
  const config = await readJson(configPath, null);
  if (!config?.project?.currentSite?.url) throw new Error("Missing current site URL in benchmark config.");

  const startUrl = config.project.currentSite.url;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    colorScheme: "light",
  });

  const queue = [startUrl];
  const seen = new Set();
  const pages = [];
  const evidence = [];

  try {
    while (queue.length && pages.length < limit) {
      const url = queue.shift();
      if (!url || seen.has(url) || !isSameSite(url, startUrl) || shouldSkip(url)) continue;
      seen.add(url);

      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        const inventory = await collectPageInventory(page);
        const slug = slugify(inventory.finalUrl || url);
        const pageDir = path.join(screenshotsRoot, slug);
        await ensureDir(pageDir);
        const desktopPath = path.join(pageDir, "desktop-full-page.png");
        await page.screenshot({ path: desktopPath, fullPage: true, animations: "disabled" });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(pageDir, "mobile-full-page.png"), fullPage: true, animations: "disabled" });

        const record = {
          url,
          title: inventory.title,
          finalUrl: inventory.finalUrl,
          slug,
          headings: inventory.headings,
          sections: inventory.sections,
          links: inventory.links,
          wordCount: inventory.wordCount,
          screenshots: {
            desktop: path.relative(root, desktopPath),
            mobile: path.relative(root, path.join(pageDir, "mobile-full-page.png")),
          },
          capturedAt: new Date().toISOString(),
        };
        pages.push(record);
        evidence.push({ type: "current-site-page", category: "institutional-trust", site: "rtih-current", ...record });

        for (const link of inventory.links) {
          const next = normalizeUrl(link.href, inventory.finalUrl || url);
          if (next && isSameSite(next, startUrl) && !seen.has(next) && !shouldSkip(next)) {
            queue.push(next);
          }
        }
      } catch (error) {
        evidence.push({
          type: "current-site-error",
          category: "institutional-trust",
          site: "rtih-current",
          url,
          error: error.message,
          capturedAt: new Date().toISOString(),
        });
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close();
  }

  const inventory = {
    site: config.project.currentSite,
    startUrl,
    capturedAt: new Date().toISOString(),
    pageCount: pages.length,
    pages,
  };
  await ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, JSON.stringify(inventory, null, 2));
  await ensureDir(path.dirname(evidencePath));
  await fs.appendFile(evidencePath, evidence.map((record) => JSON.stringify(record)).join("\n") + "\n");
  console.log(`Current-site crawl captured ${pages.length} page(s): ${path.relative(root, outPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
