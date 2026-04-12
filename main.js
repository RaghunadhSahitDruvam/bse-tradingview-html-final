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

// ─── Parallel browser configuration ──────────────────────────────────────────
const NUM_PARALLEL_BROWSERS = 5;

// Render a simple ASCII progress bar
const generateProgressBar = (completed, total, width = 25) => {
  const pct = total > 0 ? completed / total : 0;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
};

// Launch a fresh Puppeteer browser
const launchBrowser = async (headless) => {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  const forceHeadless =
    process.env.FORCE_HEADLESS === "true" ||
    process.env.NODE_ENV === "production" ||
    !process.env.DISPLAY;
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
    timeout: 60000,
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
    typeof response.data === "string" ? JSON.parse(response.data) : response.data;

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
  await page.close();
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
        console.log(`✅ Loaded ${payload.Table.length} stocks from browser fallback`);
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

// One browser worker: configures timeframe, then scrapes its allocated stocks
// in batches of customConfig.batchSize parallel tabs.
const runBrowserWorker = async (
  browserIdx,
  stockSubset,
  customConfig,
  progressTracker,
) => {
  let browser;
  try {
    browser = await launchBrowser(customConfig.headless);
    activeBrowsers.push(browser);

    console.log(
      `\n🌐 Browser ${browserIdx + 1}/${NUM_PARALLEL_BROWSERS}: Configuring timeframe (${customConfig.timeframe})...`,
    );
    await configureBrowserTimeframe(browser, customConfig);
    console.log(
      `✅ Browser ${browserIdx + 1}/${NUM_PARALLEL_BROWSERS}: Timeframe set — assigned ${stockSubset.length} stocks`,
    );

    const results = [];
    const totalBatches = Math.ceil(stockSubset.length / customConfig.batchSize);

    for (let i = 0; i < stockSubset.length; i += customConfig.batchSize) {
      const batch = stockSubset.slice(i, i + customConfig.batchSize);
      const batchNum = Math.floor(i / customConfig.batchSize) + 1;

      const batchPromises = batch.map(async (stock) => {
        const { scripname, ltradert, LONG_NAME } = stock;
        try {
          const completeConfig = {
            ...customConfig,
            canvasSelector: config.canvasSelector,
            timeframeSelector: getButtonSelector(customConfig.timeframe),
            indicatorSelectors: config.indicators[customConfig.indicatorName],
            baseConfig: config,
          };
          const liveBreakout = await fetch_tv_data(
            browser,
            scripname,
            ltradert,
            LONG_NAME,
            completeConfig,
            customConfig.dateSelection || "today",
          );
          const stockResult = { ...stock, ...liveBreakout };

          // In live mode, immediately surface breakout stocks
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

          return stockResult;
        } catch (error) {
          const errorMessage = error.message || error.toString();
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
          return {
            ...stock,
            isBreakout: false,
            value: null,
            comp_name: LONG_NAME,
            current_market_price: parseFloat(ltradert) || 0,
            trendline_strength: 0,
            pivot_point_strength: 0,
            ema_strength: 0,
            rs_strength: 0,
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // ── Progress log ─────────────────────────────────────────────────────
      progressTracker.completed += batch.length;
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
        `📊 [B${browserIdx + 1} | batch ${batchNum}/${totalBatches}] ` +
          `${bar} ${progressTracker.completed}/${progressTracker.total} scraped — ${pct}% done` +
          (breakoutsLocal > 0
            ? ` │ 🎯 ${breakoutsLocal} breakout(s) so far`
            : ""),
      );
    }

    const totalBreakoutsInWorker = results.filter(
      (r) => r.isBreakout === true,
    ).length;
    console.log(
      `\n🏁 Browser ${browserIdx + 1}/${NUM_PARALLEL_BROWSERS}: Done — ` +
        `${stockSubset.length} stocks processed, ${totalBreakoutsInWorker} breakout(s) found`,
    );
    return results;
  } catch (error) {
    console.error(`❌ Browser ${browserIdx + 1} crashed: ${error.message}`);
    // Return neutral results so the main aggregation still works
    return stockSubset.map((stock) => ({
      ...stock,
      isBreakout: false,
      value: null,
      comp_name: stock.LONG_NAME,
      current_market_price: parseFloat(stock.ltradert) || 0,
      trendline_strength: 0,
      pivot_point_strength: 0,
      ema_strength: 0,
      rs_strength: 0,
    }));
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
      activeBrowsers = activeBrowsers.filter((b) => b !== browser);
    }
  }
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

// Main scraping function — orchestrates BSE fetch + 5 parallel browser workers
const main = async (customConfig) => {
  try {
    console.log(`\n${"═".repeat(65)}`);
    console.log(
      `🚀 SCRAPER START │ Timeframe: ${customConfig.timeframe} │ Indicator: ${customConfig.indicatorName}`,
    );
    console.log(
      `   Browsers: ${NUM_PARALLEL_BROWSERS} │ Tabs/browser: ${customConfig.batchSize} │ Date: ${
        customConfig.selectedDate || customConfig.dateSelection
      }`,
    );
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

    // ── Phase 2: Distribute stocks across browsers (round-robin by block) ─
    console.log(`${"─".repeat(65)}`);
    console.log(
      `📋 PHASE 2 — Distributing stocks across ${NUM_PARALLEL_BROWSERS} browsers`,
    );
    console.log(`${"─".repeat(65)}`);

    const batchSize = customConfig.batchSize;
    const browserQueues = Array.from(
      { length: NUM_PARALLEL_BROWSERS },
      () => [],
    );

    // Each consecutive block of batchSize stocks is assigned to the next browser
    // in round-robin order, so:
    //   Browser 1 → blocks 0, 5, 10 ...  (stocks  0-4,  25-29, 50-54 …)
    //   Browser 2 → blocks 1, 6, 11 ...  (stocks  5-9,  30-34, 55-59 …)
    //   Browser 3 → blocks 2, 7, 12 ...  (stocks 10-14, 35-39, 60-64 …)
    //   Browser 4 → blocks 3, 8, 13 ...  (stocks 15-19, 40-44, 65-69 …)
    //   Browser 5 → blocks 4, 9, 14 ...  (stocks 20-24, 45-49, 70-74 …)
    for (let i = 0; i < stocks.length; i += batchSize) {
      const browserIdx = Math.floor(i / batchSize) % NUM_PARALLEL_BROWSERS;
      browserQueues[browserIdx].push(...stocks.slice(i, i + batchSize));
    }

    browserQueues.forEach((queue, idx) => {
      console.log(`   🌐 Browser ${idx + 1}: ${queue.length} stocks`);
    });
    console.log("");

    // ── Phase 3: Launch all browser workers in parallel ───────────────────
    console.log(`${"─".repeat(65)}`);
    console.log(
      `⚡ PHASE 3 — Launching ${NUM_PARALLEL_BROWSERS} browsers in parallel`,
    );
    console.log(`${"─".repeat(65)}`);

    const progressTracker = { completed: 0, total: stocks.length };

    const workerPromises = browserQueues.map((queue, browserIdx) =>
      runBrowserWorker(browserIdx, queue, customConfig, progressTracker),
    );
    const allResults = await Promise.all(workerPromises);
    const processedData = allResults.flat();

    const finalBreakoutStocks = processedData.filter(
      (stock) => stock.isBreakout === true,
    );

    console.log(`\n${"═".repeat(65)}`);
    console.log(`🏁 SCRAPING COMPLETE`);
    console.log(`   ✅ Total stocks processed : ${processedData.length}`);
    console.log(`   🎯 Breakout stocks found  : ${finalBreakoutStocks.length}`);
    console.log(`${"═".repeat(65)}\n`);

    // AI Analysis for breakout stocks
    if (finalBreakoutStocks.length > 0) {
      console.log(
        `\n🤖 Starting AI analysis for ${finalBreakoutStocks.length} breakout stocks...`,
      );
      const analyzedStocks = await analyzeBreakoutStocks(finalBreakoutStocks);
      return analyzedStocks;
    }

    return finalBreakoutStocks;
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
      dateSelection,
      customDate,
      headless,
      liveMode,
    } = req.body;

    const resolvedDate = resolveRequestedDate(dateSelection, customDate);

    // Handle "all" mode - run all indicators and all timeframes
    if (timeframe === "all" || indicator === "all") {
      const baseConfig = {
        batchSize: parseInt(batchSize),
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
