// main.js
// Required dependencies
require("dotenv").config();
const axios = require("axios");
const puppeteer = require("puppeteer");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const path = require("path");
const { config } = require("./config.js");
const fetch_tv_data = require("./tv.js");
const handleFileWriting = require("./handleWriteFile.js");
const { analyzeBreakoutStocks } = require("./aiAnalysis.js");
const { saveToLocalDataFolder } = require("./handleLocalDataWriting.js");
const {
  publishScrapeResults,
  PUBLISHED_DATA_DIR,
} = require("./publishScrapeResults.js");

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from the 'public' directory (where your index.html is)
app.use(express.static(path.join(__dirname, "public")));
app.use("/published-data", express.static(PUBLISHED_DATA_DIR));

// Global data storage
let data = [];
let breakoutStocks = [];
let isCurrentlyProcessing = false;
let activeBrowsers = []; // All currently open browsers (for parallel execution & graceful stop)
let isLiveMode = false; // Track if we're in live mode for incremental updates

const COOKIES_PATH =
  process.env.COOKIES_PATH || path.join(__dirname, "cookies.json");

// Validate indicator name against config
const validateIndicatorName = (indicatorName) => {
  if (!config.indicatorNames.includes(indicatorName)) {
    throw new Error(
      `Invalid indicator name: ${indicatorName}. Valid options are: ${config.indicatorNames.join(
        ", ",
      )}`,
    );
  }
  return true;
};

// Get button selector based on timeframe
const getButtonSelector = (timeframe) => {
  const selectorMap = {
    "5mi": config.fiveMinuteButtonSelector,
    "15m": config.fifteenMinuteButtonSelector,
    "30m": config.thirtyMinuteButtonSelector,
    "2h": config.twoHourButtonSelector,
    "1d": config.dailyButtonSelector,
    "1w": config.weeklyButtonSelector,
    "1m": config.monthlyButtonSelector,
  };
  return selectorMap[timeframe] || config.dailyButtonSelector;
};

// All timeframes and indicators for parallel scraping (excluding 5mi)
const ALL_TIMEFRAMES = ["15m", "30m", "2h", "1d", "1w", "1m"];
const ALL_INDICATORS = ["TrendLines", "Volumetric-Ulgo"];

const DEFAULT_BROWSER_COUNT = 1;
const MAX_BROWSER_COUNT = 20;
const BROWSER_RETRY_DELAY_MS = 2000;

// Render a simple ASCII progress bar
const generateProgressBar = (completed, total, width = 25) => {
  const pct = total > 0 ? completed / total : 0;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
};

const resolveBrowserCount = (requestedCount) => {
  const parsedCount = Number.parseInt(requestedCount, 10);
  if (Number.isNaN(parsedCount)) {
    return DEFAULT_BROWSER_COUNT;
  }

  return Math.min(MAX_BROWSER_COUNT, Math.max(1, parsedCount));
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRecoverableBrowserError = (error) => {
  const errorMessage = (
    error?.message ||
    error?.toString() ||
    ""
  ).toLowerCase();
  return [
    "failed to launch the browser process",
    "browser has disconnected",
    "connection closed",
    "target closed",
    "session closed",
    "econnreset",
    "socket hang up",
    "frame got detached",
    "protocol error",
  ].some((pattern) => errorMessage.includes(pattern));
};

const buildNeutralStockResult = (stock) => ({
  ...stock,
  isBreakout: false,
  value: null,
  comp_name: stock.LONG_NAME,
  current_market_price: parseFloat(stock.ltradert) || 0,
  trendline_strength: 0,
  pivot_point_strength: 0,
  ema_strength: 0,
  rs_strength: 0,
});

const cleanupBrowserSession = async (browser, page) => {
  if (page) {
    await page.close().catch(() => {});
  }
  if (browser) {
    await browser.close().catch(() => {});
    activeBrowsers = activeBrowsers.filter((b) => b !== browser);
  }
};

// Launch a fresh Puppeteer browser
const launchBrowser = async (headless) => {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  const forceHeadless = true;
  const resolvedHeadless = forceHeadless ? true : headless;

  if (forceHeadless && headless !== true) {
    console.log("ℹ️  Forcing headless mode for server/container runtime");
  }

  const headlessMode = resolvedHeadless === true ? "new" : resolvedHeadless;

  return puppeteer.launch({
    headless: headlessMode,
    ...(executablePath ? { executablePath } : {}),
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
      "--metrics-recording-only",
      // ✅ ADD THESE — they make a massive difference:
      "--disable-translate",
      "--disable-notifications",
      "--disable-infobars",
      "--disable-popup-blocking",
      "--disable-hang-monitor",
      "--disable-prompt-on-repost",
      "--disable-client-side-phishing-detection",
      "--disable-component-update",
      "--disable-domain-reliability",
      "--disable-features=AudioServiceOutOfProcess",
      "--no-zygote", // Faster process startup
      "--single-process", // Useful on low-RAM servers (use carefully)
      "--memory-pressure-off",
      "--window-size=1280,720", // Smaller window = less rendering overhead
    ],
    timeout: 15000,
  });
};

const fetchBseStocksDirectly = async () => {
  const response = await axios.get(config.targetRequestUrl, {
    timeout: 30000,
    headers: {
      Accept: "application/json, text/plain, */*",
      Referer: config.bseUrl,
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      Origin: "https://www.bseindia.com",
    },
  });

  const payload =
    typeof response.data === "string"
      ? JSON.parse(response.data)
      : response.data;

  if (!payload || !Array.isArray(payload.Table)) {
    throw new Error("BSE API returned an unexpected payload shape");
  }

  return payload.Table;
};

// Open a page in the given browser, navigate to the chart base URL, and click
// the correct timeframe button before saving — this rewrites the shared TV layout
// so every subsequent stock page in that browser already uses the right timeframe.
const configureBrowserTimeframe = async (browser, customConfig) => {
  const page = await browser.newPage();
  if (fs.existsSync(COOKIES_PATH)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH));
    await page.setCookie(...cookies);
  }
  await page.goto(config.baseUrl);
  const buttonSelector = getButtonSelector(customConfig.timeframe);
  await page.waitForSelector(buttonSelector, { timeout: 10000 });
  await page.click(buttonSelector);
  await page.waitForSelector(config.saveButtonSelector, { timeout: 10000 });
  await page.click(config.saveButtonSelector);
  // ✅ Wait for a network idle or a confirmation element after saving
  await page
    .waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 })
    .catch(() => {}); // silently ignore if no navigation occurs
  return page;
};

// Dedicated browser that intercepts the BSE XHR and returns the stock list.
const fetchBseStocks = async (customConfig) => {
  try {
    const directStocks = await fetchBseStocksDirectly();
    console.log(`✅ Loaded ${directStocks.length} stocks from direct BSE API`);
    return directStocks;
  } catch (directError) {
    console.warn(
      `⚠️  Direct BSE API fetch failed, falling back to browser interception: ${directError.message}`,
    );
  }

  let browser;
  try {
    browser = await launchBrowser(customConfig.headless);
    activeBrowsers.push(browser);

    const page = await browser.newPage();
    if (fs.existsSync(COOKIES_PATH)) {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH));
      await page.setCookie(...cookies);
    }
    await page.setRequestInterception(true);
    let targetResponseBody = null;
    page.on("request", (request) => request.continue());
    page.on("response", async (response) => {
      if (
        response.request().resourceType() === "xhr" &&
        response.request().url().includes(config.targetRequestUrl)
      ) {
        targetResponseBody = await response.text();
      }
    });
    await page.goto(config.bseUrl);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await page.close();
    await browser.close();
    activeBrowsers = activeBrowsers.filter((b) => b !== browser);

    if (targetResponseBody !== null) {
      const payload = JSON.parse(targetResponseBody);
      if (payload && Array.isArray(payload.Table)) {
        console.log(
          `✅ Loaded ${payload.Table.length} stocks from browser fallback`,
        );
        return payload.Table;
      }
    }
    return [];
  } catch (error) {
    if (browser) {
      await browser.close().catch(() => {});
      activeBrowsers = activeBrowsers.filter((b) => b !== browser);
    }
    throw error;
  }
};

const runBrowserWorker = async (
  browserIdx,
  stockSubset,
  customConfig,
  progressTracker,
  browserCount,
) => {
  const results = [];
  let currentIndex = 0;
  let launchAttempt = 0;
  let browser = null;
  let page = null;

  while (currentIndex < stockSubset.length) {
    try {
      launchAttempt += 1;
      browser = await launchBrowser(customConfig.headless);
      activeBrowsers.push(browser);

      console.log(
        `\n🌐 Browser ${browserIdx + 1}/${browserCount}: Configuring timeframe (${customConfig.timeframe})... [attempt ${launchAttempt}]`,
      );
      page = await configureBrowserTimeframe(browser, customConfig);
      console.log(
        `✅ Browser ${browserIdx + 1}/${browserCount}: Timeframe set — assigned ${stockSubset.length} stocks`,
      );

      while (currentIndex < stockSubset.length) {
        const stock = stockSubset[currentIndex];
        const { scripname, ltradert, LONG_NAME } = stock;
        let stockResult;

        if (!browser.isConnected() || page.isClosed()) {
          throw new Error("Browser session became unavailable during scraping");
        }

        try {
          const completeConfig = {
            ...customConfig,
            canvasSelector: config.canvasSelector,
            timeframeSelector: getButtonSelector(customConfig.timeframe),
            indicatorSelectors: config.indicators[customConfig.indicatorName],
            baseConfig: config,
            reuseSymbolSearch: currentIndex > 0,
            openDataWindow: currentIndex === 0,
          };
          const liveBreakout = await fetch_tv_data(
            page,
            scripname,
            ltradert,
            LONG_NAME,
            completeConfig,
            customConfig.dateSelection || "today",
          );
          stockResult = { ...stock, ...liveBreakout };

          if (isLiveMode && stockResult.isBreakout === true) {
            const exists = breakoutStocks.some(
              (s) => s.scripname === stockResult.scripname,
            );
            if (!exists) {
              breakoutStocks.push(stockResult);
              console.log(
                `🔴 LIVE: Added ${scripname} to breakout list (Total: ${breakoutStocks.length})`,
              );
            }
          }
        } catch (error) {
          const errorMessage = error.message || error.toString();
          if (isRecoverableBrowserError(error)) {
            throw error;
          }

          if (
            errorMessage.includes("frame got detached") ||
            errorMessage.includes("Protocol error") ||
            errorMessage.includes("Connection closed") ||
            errorMessage.includes("Target closed") ||
            errorMessage.includes("Session closed")
          ) {
            console.log(
              `⚠️  Browser ${browserIdx + 1}: Skipping ${scripname} (connection/frame error)`,
            );
          } else {
            console.log(
              `⚠️  Browser ${browserIdx + 1}: Skipping ${scripname} — ${errorMessage}`,
            );
          }
          stockResult = {
            ...buildNeutralStockResult(stock),
            comp_name: LONG_NAME,
          };
        }

        results.push(stockResult);
        currentIndex += 1;
        progressTracker.completed += 1;
        const pct = (
          (progressTracker.completed / progressTracker.total) *
          100
        ).toFixed(1);
        const bar = generateProgressBar(
          progressTracker.completed,
          progressTracker.total,
        );
        const breakoutsLocal = results.filter(
          (r) => r.isBreakout === true,
        ).length;
        console.log(
          `📊 [B${browserIdx + 1} | stock ${currentIndex}/${stockSubset.length}] ` +
            `${bar} ${progressTracker.completed}/${progressTracker.total} scraped — ${pct}% done` +
            (breakoutsLocal > 0
              ? ` │ 🎯 ${breakoutsLocal} breakout(s) so far`
              : ""),
        );
      }
    } catch (error) {
      const attemptLabel =
        launchAttempt > 1 ? ` (attempt ${launchAttempt})` : "";
      console.error(
        `❌ Browser ${browserIdx + 1} crashed${attemptLabel}: ${error.message}`,
      );

      await cleanupBrowserSession(browser, page);
      browser = null;
      page = null;

      console.log(
        `🔁 Browser ${browserIdx + 1}: Restarting worker from stock ${currentIndex + 1}/${stockSubset.length} in ${BROWSER_RETRY_DELAY_MS}ms...`,
      );
      await delay(BROWSER_RETRY_DELAY_MS);
      continue;
    }

    break;
  }

  await cleanupBrowserSession(browser, page);

  const totalBreakoutsInWorker = results.filter(
    (r) => r.isBreakout === true,
  ).length;
  console.log(
    `\n🏁 Browser ${browserIdx + 1}/${browserCount}: Done — ` +
      `${stockSubset.length} stocks processed, ${totalBreakoutsInWorker} breakout(s) found`,
  );
  return results;
};

const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isValidYmdDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsedDate = new Date(`${value}T00:00:00`);
  return (
    !Number.isNaN(parsedDate.getTime()) && formatLocalDate(parsedDate) === value
  );
};

const resolveRequestedDate = (dateSelection, customDate) => {
  const today = new Date();
  const selectedDate = new Date(today);

  if (dateSelection === "custom") {
    if (!isValidYmdDate(customDate)) {
      throw new Error("A valid custom date is required in YYYY-MM-DD format.");
    }

    return {
      dateSelection: "custom",
      selectedDate: customDate,
    };
  }

  if (dateSelection === "yesterday") {
    selectedDate.setDate(selectedDate.getDate() - 1);
    return {
      dateSelection: "yesterday",
      selectedDate: formatLocalDate(selectedDate),
    };
  }

  return {
    dateSelection: "today",
    selectedDate: formatLocalDate(today),
  };
};

// Calculate batch size for 5% milestone restarts
const calculateBatchSize = (totalStocks) => {
  const batchSize = Math.max(1, Math.ceil(totalStocks / 20));
  return batchSize;
};

// Process a batch of stocks with browser restart between batches
const processBatchWithRestart = async (
  stocks,
  customConfig,
  browserCount,
  startOffset,
  totalStocks,
  allResults,
  allBreakouts,
) => {
  const browserQueues = Array.from({ length: browserCount }, () => []);

  stocks.forEach((stock, index) => {
    browserQueues[index % browserCount].push(stock);
  });

  const progressTracker = { completed: startOffset, total: totalStocks };

  const workerPromises = browserQueues
    .map((queue, browserIdx) => ({ queue, browserIdx }))
    .filter(({ queue }) => queue.length > 0)
    .map(({ queue, browserIdx }) =>
      runBrowserWorker(
        browserIdx,
        queue,
        customConfig,
        progressTracker,
        browserCount,
      ),
    );

  const batchResults = await Promise.all(workerPromises);
  const processedBatch = batchResults.flat();

  const batchBreakouts = processedBatch.filter(
    (stock) => stock.isBreakout === true,
  );

  allResults.push(...processedBatch);
  allBreakouts.push(...batchBreakouts);

  const endProgress = startOffset + stocks.length;
  const percentComplete = ((endProgress / totalStocks) * 100).toFixed(1);

  console.log(`\n${"═".repeat(65)}`);
  console.log(
    `📊 BATCH COMPLETE: ${endProgress}/${totalStocks} stocks (${percentComplete}%)`,
  );
  console.log(`   🎯 Breakouts found in this batch: ${batchBreakouts.length}`);
  if (batchBreakouts.length > 0) {
    batchBreakouts.forEach((stock) => {
      console.log(
        `   🔴 ${stock.scripname} - ${stock.comp_name || stock.LONG_NAME}`,
      );
    });
  }
  console.log(`   📈 Total breakouts so far: ${allBreakouts.length}`);
  console.log(`${"═".repeat(65)}\n`);

  return { completed: endProgress };
};

// Main scraping function — orchestrates BSE fetch + 5% batch processing with browser restarts
const main = async (customConfig) => {
  try {
    const browserCount = resolveBrowserCount(customConfig.browserCount);

    console.log(`\n${"═".repeat(65)}`);
    console.log(
      `🚀 SCRAPER START │ Timeframe: ${customConfig.timeframe} │ Indicator: ${customConfig.indicatorName}`,
    );
    console.log(
      `   Browsers: ${browserCount} │ Tabs/browser: 1 │ Date: ${
        customConfig.selectedDate || customConfig.dateSelection
      }`,
    );
    console.log(`   🔄 Browser restart: Every 5% of stocks`);
    console.log(`${"═".repeat(65)}\n`);

    // ── Phase 1: Fetch BSE stock list ─────────────────────────────────────
    console.log(`${"─".repeat(65)}`);
    console.log(`📡 PHASE 1 — Fetching BSE market data`);
    console.log(`${"─".repeat(65)}`);
    const stocks = await fetchBseStocks(customConfig);

    if (stocks.length === 0) {
      console.log("⚠️  No stocks received from BSE API.");
      return [];
    }
    console.log(`✅ ${stocks.length} stocks loaded from BSE\n`);

    // ── Phase 2: Process in 5% batches with browser restarts ─────────────
    console.log(`${"─".repeat(65)}`);
    console.log(`📋 PHASE 2 — Processing in 5% batches`);
    console.log(`${"─".repeat(65)}`);

    const batchSize = calculateBatchSize(stocks.length);
    const totalBatches = Math.ceil(stocks.length / batchSize);

    console.log(`   📦 Batch size: ${batchSize} stocks`);
    console.log(`   📊 Total batches: ${totalBatches}`);
    console.log(`   🌐 Browsers per batch: ${browserCount}`);
    console.log("");

    const allResults = [];
    const allBreakouts = [];
    let currentOffset = 0;

    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const startIdx = batchNum * batchSize;
      const endIdx = Math.min(startIdx + batchSize, stocks.length);
      const batchStocks = stocks.slice(startIdx, endIdx);

      const currentBatch = batchNum + 1;
      const batchProgress = ((startIdx / stocks.length) * 100).toFixed(1);

      console.log(`${"─".repeat(65)}`);
      console.log(
        `🔄 BATCH ${currentBatch}/${totalBatches} — Processing stocks ${startIdx + 1}-${endIdx} (${batchProgress}%)`,
      );
      console.log(`${"─".repeat(65)}`);

      await processBatchWithRestart(
        batchStocks,
        customConfig,
        browserCount,
        currentOffset,
        stocks.length,
        allResults,
        allBreakouts,
      );

      currentOffset = endIdx;

      if (batchNum < totalBatches - 1) {
        console.log(`⏳ Closing all browsers...`);
        await Promise.all(activeBrowsers.map((b) => b.close().catch(() => {})));
        activeBrowsers = [];
        console.log(`⏳ Waiting 5 seconds before starting next batch...`);
        await delay(5000);
        console.log(`✅ Restarting browsers for next batch\n`);
      }
    }

    console.log(`\n${"═".repeat(65)}`);
    console.log(`🏁 SCRAPING COMPLETE`);
    console.log(`   ✅ Total stocks processed : ${allResults.length}`);
    console.log(`   🎯 Breakout stocks found  : ${allBreakouts.length}`);
    console.log(`${"═".repeat(65)}\n`);

    if (allBreakouts.length > 0) {
      console.log(`\n🎯 BREAKOUT STOCKS SUMMARY:`);
      allBreakouts.forEach((stock, idx) => {
        console.log(
          `   ${idx + 1}. ${stock.scripname} - ${stock.comp_name || stock.LONG_NAME}`,
        );
      });
      console.log("");
    }

    // AI Analysis for breakout stocks
    if (allBreakouts.length > 0) {
      console.log(
        `\n🤖 Starting AI analysis for ${allBreakouts.length} breakout stocks...`,
      );
      const analyzedStocks = await analyzeBreakoutStocks(allBreakouts);
      return analyzedStocks;
    }

    return allBreakouts;
  } catch (error) {
    console.error("Error in main scraping function:", error);
    await Promise.all(activeBrowsers.map((b) => b.close().catch(() => {})));
    activeBrowsers = [];
    throw error;
  }
};

// SCRAPER RUNNER - FILE MODE
const runScraper = async (customConfig) => {
  isCurrentlyProcessing = true;
  try {
    const scrapedBreakoutStocks = await main(customConfig);
    const publishedResult = await publishScrapeResults(scrapedBreakoutStocks, {
      indicatorName: customConfig.indicatorName,
      timeframe: customConfig.timeframe,
    });

    if (scrapedBreakoutStocks.length === 0) {
      return {
        success: true,
        mode: "file",
        message: "No breakout stocks found.",
        fileName: null,
        breakoutStocks: 0,
        publishedUrl: `/published-data/${publishedResult.dateLabel}.json`,
        latestPublishedUrl: "/published-data/latest.json",
      };
    }

    const result = await handleFileWriting(scrapedBreakoutStocks, {
      indicatorName: customConfig.indicatorName,
      timeframe: customConfig.timeframe,
    });

    return {
      success: true,
      mode: "file",
      message: "Scraping completed successfully",
      fileName: result.fileName,
      breakoutStocks: scrapedBreakoutStocks.length,
      publishedUrl: `/published-data/${publishedResult.dateLabel}.json`,
      latestPublishedUrl: "/published-data/latest.json",
    };
  } catch (error) {
    console.error("Scraping failed:", error);
    return {
      success: false,
      mode: "file",
      message: "Scraping failed: " + error.message,
    };
  } finally {
    isCurrentlyProcessing = false;
  }
};

// SCRAPER RUNNER - LIVE MODE
const runScraperForLive = async (customConfig) => {
  isCurrentlyProcessing = true;
  isLiveMode = true; // Enable live mode for incremental updates
  breakoutStocks = []; // Clear previous breakout stocks at the start of a new live scan
  try {
    console.log("🔴 LIVE MODE: Starting live scraper...");
    console.log(
      "🔴 LIVE MODE: Breakout stocks will be updated in real-time as they are detected.",
    );
    const scrapedBreakoutStocks = await main(customConfig);
    // In live mode, breakoutStocks is already populated incrementally
    // But we also ensure final sync in case any were missed
    scrapedBreakoutStocks.forEach((stock) => {
      if (stock.isBreakout === true) {
        const exists = breakoutStocks.some(
          (s) => s.scripname === stock.scripname,
        );
        if (!exists) {
          breakoutStocks.push(stock);
        }
      }
    });
    console.log(
      `🔴 LIVE UPDATE: Scan complete. Total ${breakoutStocks.length} breakout stocks found.`,
    );
    return {
      success: true,
      mode: "live",
      message: "Live scan complete. Displaying results.",
      breakoutStocks: breakoutStocks.length,
    };
  } catch (error) {
    console.error("Live scraping failed:", error);
    return {
      success: false,
      mode: "live",
      message: "Live scraping failed: " + error.message,
    };
  } finally {
    isCurrentlyProcessing = false;
    isLiveMode = false; // Reset live mode flag
  }
};

// SCRAPER RUNNER - ALL INDICATORS ALL TIMEFRAMES MODE
const runAllIndicatorsAllTimeframes = async (baseConfig) => {
  isCurrentlyProcessing = true;
  const results = [];

  // Generate all combinations
  const combinations = [];
  for (const timeframe of ALL_TIMEFRAMES) {
    for (const indicator of ALL_INDICATORS) {
      combinations.push({ timeframe, indicator });
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🚀 ALL INDICATORS - ALL TIMEFRAMES MODE`);
  console.log(
    `📊 Processing ${combinations.length} combinations in parallel...`,
  );
  console.log(`${"=".repeat(60)}\n`);

  // Log all combinations
  combinations.forEach((combo, index) => {
    console.log(`   ${index + 1}. ${combo.timeframe} - ${combo.indicator}`);
  });
  console.log("");

  try {
    // Run all combinations in parallel
    const promises = combinations.map(async ({ timeframe, indicator }) => {
      const customConfig = {
        ...baseConfig,
        timeframe,
        indicatorName: indicator,
      };

      console.log(`\n🔄 Starting: ${timeframe} - ${indicator}`);

      try {
        const scrapedData = await main(customConfig);

        // Filter only breakout stocks
        const breakoutStocks = scrapedData.filter(
          (stock) => stock.isBreakout === true,
        );

        console.log(
          `✅ Completed: ${timeframe} - ${indicator} | Found ${breakoutStocks.length} breakouts`,
        );

        // Save to local data folder
        if (breakoutStocks.length > 0) {
          await saveToLocalDataFolder(breakoutStocks, indicator, timeframe);
        } else {
          console.log(
            `   ℹ️  No breakout stocks to save for ${timeframe} - ${indicator}`,
          );
        }

        return {
          timeframe,
          indicator,
          success: true,
          breakoutCount: breakoutStocks.length,
          message: `Found ${breakoutStocks.length} breakout stocks`,
        };
      } catch (error) {
        console.error(
          `❌ Failed: ${timeframe} - ${indicator} | Error: ${error.message}`,
        );
        return {
          timeframe,
          indicator,
          success: false,
          breakoutCount: 0,
          error: error.message,
        };
      }
    });

    const allResults = await Promise.all(promises);

    // Generate summary
    const successCount = allResults.filter((r) => r.success).length;
    const failCount = allResults.filter((r) => !r.success).length;
    const totalBreakouts = allResults.reduce(
      (sum, r) => sum + r.breakoutCount,
      0,
    );

    console.log(`\n${"=".repeat(60)}`);
    console.log(`📊 ALL INDICATORS - ALL TIMEFRAMES SUMMARY`);
    console.log(`${"=".repeat(60)}`);
    console.log(`✅ Successful: ${successCount}/${combinations.length}`);
    console.log(`❌ Failed: ${failCount}/${combinations.length}`);
    console.log(`📈 Total Breakout Stocks Found: ${totalBreakouts}`);
    console.log(`${"=".repeat(60)}\n`);

    return {
      success: true,
      mode: "all",
      message: `Processed ${combinations.length} combinations`,
      summary: {
        total: combinations.length,
        successful: successCount,
        failed: failCount,
        totalBreakouts,
      },
      results: allResults,
    };
  } catch (error) {
    console.error("Error in runAllIndicatorsAllTimeframes:", error);
    return {
      success: false,
      mode: "all",
      message: error.message,
      results: [],
    };
  } finally {
    isCurrentlyProcessing = false;
  }
};

// --- API ROUTES ---

// Serve the main HTML page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// API endpoint to run the scraper
app.post("/api/run-scraper", async (req, res) => {
  try {
    if (isCurrentlyProcessing) {
      return res
        .status(400)
        .json({ success: false, message: "Scraper is already running" });
    }
    const {
      timeframe,
      indicator,
      batchSize,
      browserCount,
      dateSelection,
      customDate,
      headless,
      liveMode,
    } = req.body;

    const resolvedDate = resolveRequestedDate(dateSelection, customDate);
    const resolvedBrowserCount = resolveBrowserCount(browserCount ?? batchSize);

    // Handle "all" mode - run all indicators and all timeframes
    if (timeframe === "all" || indicator === "all") {
      const baseConfig = {
        batchSize: parseInt(batchSize),
        browserCount: resolvedBrowserCount,
        dateSelection: resolvedDate.dateSelection,
        selectedDate: resolvedDate.selectedDate,
        headless: Boolean(headless),
        LIVE_MODE: Boolean(liveMode),
      };

      console.log("🚀 Starting All Indicators - All Timeframes mode...");
      const result = await runAllIndicatorsAllTimeframes(baseConfig);
      return res.json(result);
    }

    // Single indicator/timeframe mode
    validateIndicatorName(indicator);

    const scraperConfig = {
      timeframe,
      indicatorName: indicator,
      batchSize: parseInt(batchSize),
      browserCount: resolvedBrowserCount,
      dateSelection: resolvedDate.dateSelection,
      selectedDate: resolvedDate.selectedDate,
      headless: Boolean(headless),
      LIVE_MODE: Boolean(liveMode),
    };

    // The function calls will handle the isCurrentlyProcessing flag.
    // We await the result and send it back to the frontend.
    const result = liveMode
      ? await runScraperForLive(scraperConfig)
      : await runScraper(scraperConfig);

    res.json(result);
  } catch (error) {
    console.error("API Error in /api/run-scraper:", error);
    isCurrentlyProcessing = false; // Safeguard
    res.status(500).json({
      success: false,
      message: error.message || "An internal server error occurred.",
    });
  }
});

// API endpoint to get live breakout stocks
app.get("/api/breakouts", (req, res) => {
  res.json(breakoutStocks);
});

// API endpoint to get the latest published scrape result
app.get("/api/published/latest", async (req, res) => {
  try {
    const latestPath = path.join(PUBLISHED_DATA_DIR, "latest.json");
    if (!fs.existsSync(latestPath)) {
      return res.status(404).json({
        success: false,
        message: "No published data found yet.",
      });
    }

    const content = JSON.parse(fs.readFileSync(latestPath, "utf-8"));
    res.json({ success: true, ...content });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// API endpoint to stop the scraper
app.post("/api/stop-scraper", async (req, res) => {
  try {
    if (!isCurrentlyProcessing) {
      return res.status(400).json({
        success: false,
        message: "No scraper is currently running",
      });
    }

    console.log(
      `🛑 Stop request received. Closing ${activeBrowsers.length} active browser(s)...`,
    );

    // Close all active browsers in parallel
    await Promise.all(activeBrowsers.map((b) => b.close().catch(() => {})));
    activeBrowsers = [];
    console.log("✅ All browsers closed successfully");

    // Reset processing flag
    isCurrentlyProcessing = false;

    res.json({
      success: true,
      message: "Scraper stopped successfully",
    });
  } catch (error) {
    console.error("Error stopping scraper:", error);
    isCurrentlyProcessing = false; // Reset flag even on error
    activeBrowsers = [];
    res.status(500).json({
      success: false,
      message: "Error occurred while stopping scraper: " + error.message,
    });
  }
});

// --- SERVER START ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
  console.log("   Open the URL in your browser to access the control panel.");
});
