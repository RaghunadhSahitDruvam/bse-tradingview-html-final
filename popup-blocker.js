const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { config } = require("./config.js");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const COOKIES_PATH =
  process.env.COOKIES_PATH || path.join(__dirname, "cookies.json");

(async () => {
  console.log("🌐 Launching browser for DCM stock...");
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-default-apps",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-sync",
      "--mute-audio",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-translate",
      "--disable-notifications",
      "--disable-infobars",
      "--disable-popup-blocking",
      "--disable-hang-monitor",
      "--disable-prompt-on-repost",
      "--disable-client-side-phishing-detection",
      "--disable-component-update",
      "--disable-domain-reliability",
      "--window-size=1280,720",
    ],
    timeout: 60000,
  });

  const page = await browser.newPage();

  // Load cookies if present
  if (fs.existsSync(COOKIES_PATH)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH));
      if (cookies && cookies.length > 0) {
        await page.setCookie(...cookies);
        console.log(
          `✅ Loaded ${cookies.length} cookie(s) from ${COOKIES_PATH}`,
        );
      }
    } catch (err) {
      console.log(`⚠️  Failed to load cookies: ${err.message}`);
    }
  } else {
    console.log(
      `ℹ️  No cookies file found at ${COOKIES_PATH}, proceeding without cookies`,
    );
  }

  const targetUrl = config.baseUrl;
  console.log(`🚀 Opening TradingView: ${targetUrl}`);
  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  console.log("⏳ Waiting 2 minutes...");
  await delay(120000);

  console.log("🔒 Closing browser...");
  await browser.close();
  console.log("✅ Done.");
})();
