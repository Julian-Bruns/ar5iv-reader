import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const APP_URL = "http://127.0.0.1:4173/";
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PAPER_ID = "1706.03762";
const PAPER_TITLE = "Attention Is All You Need";

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true
  });

  const findings = [];

  try {
    findings.push(...(await runDesktopLayoutCheck(browser)));
    findings.push(...(await runMobileLayoutCheck(browser)));
    findings.push(...(await runReaderBackupFlowCheck(browser)));
  } finally {
    await browser.close();
  }

  const reportPath = path.join(OUT_DIR, "report.json");
  await fs.writeFile(reportPath, `${JSON.stringify(findings, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, reportPath, findings }, null, 2));
}

async function runDesktopLayoutCheck(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1300 },
    acceptDownloads: true
  });
  const page = await context.newPage();
  const findings = [];

  try {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    await expectVisible(page.getByRole("heading", { name: "ar5iv Reader" }));
    await expectVisible(page.getByRole("heading", { name: "Open Paper" }));
    await expectVisible(page.getByRole("heading", { name: "Saved Library" }));
    await expectVisible(page.getByText("copying math formulas has never been easier"));
    await expectVisible(
      page.getByText("Paste an arXiv URL, or use the bookmarklet found in settings.")
    );

    findings.push(await readIconConfiguration(page));

    const order = await readVerticalOrder(page, [
      "header.dashboard-header",
      "section.form-card",
      "section.library-card"
    ]);
    findings.push({
      name: "desktop-main-order",
      order
    });
    ensureIncreasing(order, "Desktop main page sections are out of order.");

    await page.screenshot({
      path: path.join(OUT_DIR, "desktop-main.png"),
      fullPage: true
    });

    await page.getByRole("button", { name: "Open settings" }).click();
    await expectVisible(page.locator(".settings-modal").getByRole("heading", { name: "Settings" }));
    await expectVisible(page.locator(".settings-modal").getByRole("heading", { name: "Backup" }));
    await expectVisible(page.locator(".settings-modal").getByRole("heading", { name: "Nearby Sync" }));
    await expectVisible(page.locator(".settings-modal").getByRole("heading", { name: "Bookmarklet" }));

    await page.screenshot({
      path: path.join(OUT_DIR, "desktop-settings-open.png"),
      fullPage: true
    });

    await page.getByRole("button", { name: "Close settings" }).click();
    await expectHidden(page.locator(".settings-modal"));

    findings.push({
      name: "desktop-settings-modal",
      settingsModalOpened: true,
      settingsModalClosed: true
    });
  } finally {
    await context.close();
  }

  return findings;
}

async function runMobileLayoutCheck(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 1180 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  const findings = [];

  try {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    const order = await readVerticalOrder(page, [
      "header.dashboard-header",
      "section.form-card",
      "section.library-card"
    ]);
    findings.push({
      name: "mobile-main-order",
      order
    });
    ensureIncreasing(order, "Mobile main page sections are out of order.");

    await page.screenshot({
      path: path.join(OUT_DIR, "mobile-main.png"),
      fullPage: true
    });
  } finally {
    await context.close();
  }

  return findings;
}

async function runReaderBackupFlowCheck(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1300 },
    acceptDownloads: true
  });
  const page = await context.newPage();
  const findings = [];

  await page.addInitScript(() => {
    const originalShowSaveFilePicker = window.showSaveFilePicker?.bind(window);
    window.__browserCheckState = {
      backupFileName: "browser-check-backup.json",
      usingOriginalPicker: Boolean(originalShowSaveFilePicker),
      mirroredFiles: {}
    };

    window.showSaveFilePicker = async (options = {}) => {
      const filename = options.suggestedName || window.__browserCheckState.backupFileName;
      window.__browserCheckState.backupFileName = filename;

      return {
        name: filename,
        queryPermission: async () => "granted",
        requestPermission: async () => "granted",
        createWritable: async () => {
          let bufferedText = "";

          return {
            write: async (chunk) => {
              if (typeof chunk === "string") {
                bufferedText += chunk;
                return;
              }

              if (chunk instanceof Blob) {
                bufferedText += await chunk.text();
                return;
              }

              if (chunk && typeof chunk === "object" && "type" in chunk) {
                if (chunk.type === "write" && typeof chunk.data === "string") {
                  bufferedText += chunk.data;
                }
                return;
              }

              bufferedText += String(chunk ?? "");
            },
            close: async () => {
              window.__browserCheckState.mirroredFiles[filename] = bufferedText;
            }
          };
        }
      };
    };
  });

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.includes(`/abs/${PAPER_ID}`)) {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: buildAbsHtml()
      });
      return;
    }

    if (url.includes(`/html/${PAPER_ID}`)) {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: buildPaperHtml()
      });
      return;
    }

    await route.continue();
  });

  try {
    await page.goto(APP_URL, { waitUntil: "networkidle" });

    await page.getByPlaceholder("https://arxiv.org/abs/1706.03762").fill(PAPER_ID);
    await page.getByRole("button", { name: "Open", exact: true }).click();

    await expectVisible(page.getByText("Skim"));
    await expectVisible(page.getByRole("button", { name: "Save to Library" }));
    await expectVisible(page.locator("article.ltx_document"));

    await page.screenshot({
      path: path.join(OUT_DIR, "reader-skim.png"),
      fullPage: true
    });

    await page.getByRole("button", { name: "Save to Library" }).click();
    await expectText(page.locator(".reader-kicker"), "Saved Offline");
    await expectVisible(page.getByRole("button", { name: "More reader actions" }));

    findings.push({
      name: "reader-status-and-actions",
      status: await page.locator(".reader-kicker").textContent(),
      quickbarCount: await page.locator(".reader-quickbar").count()
    });

    await page.getByRole("button", { name: "More reader actions" }).click();
    await expectVisible(page.getByRole("menuitem", { name: "Export HTML" }));
    await expectVisible(page.getByRole("menuitem", { name: "Remove" }));

    await page.getByRole("button", { name: "Back to library" }).click();
    await expectVisible(page.getByRole("heading", { name: "Saved Library" }));
    await expectVisible(page.getByText(PAPER_TITLE));

    await page.screenshot({
      path: path.join(OUT_DIR, "library-with-paper.png"),
      fullPage: true
    });

    await page.getByRole("button", { name: "Open settings" }).click();
    await expectVisible(page.getByRole("button", { name: "Keep Backup File Updated" }));
    await page.getByRole("button", { name: "Keep Backup File Updated" }).click();
    await page.waitForTimeout(2000);

    await expectText(page.locator(".tools-subsection .status-line"), "1 of 1 papers included in backup.");
    findings.push({
      name: "backup-mirror-after-save",
      status: await page.locator(".tools-subsection .status-line").textContent(),
      mirrorSummary: await readMirrorSummary(page)
    });

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Backup" }).click();
    const backupDownload = await download;
    const backupPath = path.join(OUT_DIR, "downloaded-backup.json");
    await backupDownload.saveAs(backupPath);

    await page.getByRole("button", { name: "Close settings" }).click();
    await page
      .locator(".paper-row")
      .first()
      .getByRole("button", { name: /More actions for/i })
      .click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("menuitem", { name: "Remove" }).click();
    await expectVisible(page.getByText("No saved papers yet."));

    await page.getByRole("button", { name: "Open settings" }).click();
    await expectText(page.locator(".tools-subsection .status-line"), "0 of 0 papers included in backup.");
    findings.push({
      name: "backup-mirror-after-delete",
      status: await page.locator(".tools-subsection .status-line").textContent(),
      mirrorSummary: await readMirrorSummary(page)
    });

    await page.getByRole("button", { name: "Close settings" }).click();

    const restoreContext = await browser.newContext({
      viewport: { width: 1440, height: 1300 },
      acceptDownloads: true
    });
    const restorePage = await restoreContext.newPage();
    await restorePage.goto(APP_URL, { waitUntil: "networkidle" });
    await restorePage.getByRole("button", { name: "Open settings" }).click();
    await restorePage
      .locator('label:has-text("Restore Backup") input')
      .setInputFiles(backupPath);
    await restorePage.getByRole("button", { name: "Close settings" }).click();
    await expectVisible(restorePage.getByText(PAPER_TITLE));
    const restoreStatus = await restorePage.locator(".paper-row").count();
    const restoreMirrorSummary = {
      note: "Restored into fresh browser context without network fetch."
    };
    await restorePage.screenshot({
      path: path.join(OUT_DIR, "library-restored.png"),
      fullPage: true
    });
    await restoreContext.close();

    await expectVisible(page.getByText("No saved papers yet."));
    findings.push({
      name: "backup-restore",
      status: restoreStatus,
      mirrorSummary: restoreMirrorSummary,
      paperRestored: true
    });

    await page.getByPlaceholder("Search saved papers").fill("attention");
    await expectVisible(page.getByText("No saved papers yet."));
    findings.push({
      name: "library-search",
      query: "attention",
      visibleRows: await page.locator(".paper-row").count()
    });
  } finally {
    await context.close();
  }

  return findings;
}

function buildAbsHtml() {
  return `<!doctype html>
  <html>
    <head>
      <title>${PAPER_TITLE}</title>
    </head>
    <body>
      <main>
        <h1>${PAPER_TITLE}</h1>
        <a id="latexml-download-link" href="/html/${PAPER_ID}">HTML</a>
      </main>
    </body>
  </html>`;
}

function buildPaperHtml() {
  return `<!doctype html>
  <html>
    <head>
      <title>${PAPER_TITLE}</title>
    </head>
    <body>
      <article class="ltx_document">
        <h1 class="ltx_title ltx_title_document">${PAPER_TITLE}</h1>
        <section class="ltx_abstract">
          <p>This is a browser test fixture for the ar5iv Reader UI.</p>
        </section>
        <section class="ltx_section">
          <h2>Introduction</h2>
          <p>Rendered HTML is present, so the page should open in skim mode and allow save.</p>
        </section>
      </article>
    </body>
  </html>`;
}

async function readVerticalOrder(page, selectors) {
  return Promise.all(
    selectors.map(async (selector) => {
      const box = await page.locator(selector).boundingBox();
      if (!box) {
        throw new Error(`Missing element for selector: ${selector}`);
      }
      return {
        selector,
        y: box.y,
        height: box.height
      };
    })
  );
}

function ensureIncreasing(order, errorMessage) {
  for (let index = 1; index < order.length; index += 1) {
    if (order[index].y <= order[index - 1].y) {
      throw new Error(errorMessage);
    }
  }
}

async function readMirrorSummary(page) {
  return page.evaluate(async () => {
    const backupFileName = window.__browserCheckState?.backupFileName || "ar5iv-reader-backup.json";
    const rawContents = window.__browserCheckState?.mirroredFiles?.[backupFileName] || "";
    const parsed = JSON.parse(rawContents);
    return {
      filename: backupFileName,
      format: parsed.format,
      paperCount: Array.isArray(parsed.manifest?.papers) ? parsed.manifest.papers.length : -1,
      snapshotPaperCount: Array.isArray(parsed.librarySnapshot?.papers)
        ? parsed.librarySnapshot.papers.filter((paper) => !Number(paper?.deletedAtMs || 0)).length
        : -1
    };
  });
}

async function readIconConfiguration(page) {
  const result = await page.evaluate(async () => {
    const links = [...document.querySelectorAll('link[rel][href]')].map((element) => ({
      rel: element.rel,
      href: new URL(element.getAttribute("href"), window.location.origin).pathname,
      sizes: element.getAttribute("sizes") || ""
    }));

    const iconUrls = [
      "/icons/favicon-32.png",
      "/icons/icon.svg",
      "/icons/apple-touch-icon.png"
    ];
    const responses = await Promise.all(
      iconUrls.map(async (href) => {
        const response = await fetch(href);
        return {
          href,
          ok: response.ok,
          contentType: response.headers.get("content-type") || ""
        };
      })
    );

    return {
      name: "app-icons",
      links,
      responses
    };
  });

  const requiredLinks = [
    { rel: "icon", href: "/icons/favicon-32.png" },
    { rel: "shortcut icon", href: "/icons/favicon-32.png" },
    { rel: "icon", href: "/icons/icon.svg" },
    { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" }
  ];

  for (const requiredLink of requiredLinks) {
    const present = result.links.some(
      (link) => link.rel === requiredLink.rel && link.href === requiredLink.href
    );
    if (!present) {
      throw new Error(`Missing icon link: rel=${requiredLink.rel} href=${requiredLink.href}`);
    }
  }

  for (const response of result.responses) {
    if (!response.ok || !response.contentType.startsWith("image/")) {
      throw new Error(`Icon asset failed to load: ${response.href} (${response.contentType})`);
    }
  }

  return result;
}

async function expectVisible(locator) {
  await locator.waitFor({ state: "visible", timeout: 15000 });
}

async function expectHidden(locator) {
  await locator.waitFor({ state: "hidden", timeout: 15000 });
}

async function expectText(locator, expected) {
  await locator.waitFor({ state: "visible", timeout: 15000 });
  const startedAt = Date.now();

  while (Date.now() - startedAt < 15000) {
    const actual = (await locator.textContent())?.trim();
    if (actual === expected) {
      return;
    }
    await locator.page().waitForTimeout(200);
  }

  const actual = (await locator.textContent())?.trim();
  throw new Error(`Expected text "${expected}" but got "${actual}"`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
