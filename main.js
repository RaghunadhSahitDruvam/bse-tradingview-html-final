// main.js
// Required dependencies
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

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from the 'public' directory (where your index.html is)
app.use(express.static(path.join(__dirname, "public")));

// Global data storage
let data = [];
let breakoutStocks = [];
let isCurrentlyProcessing = false;
let currentBrowser = null;
let isLiveMode = false; // Track if we're in live mode for incremental updates

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

// Main scraping function
const main = async (customConfig) => {
  try {
    console.log(
      `Starting scraping with timeframe: ${customConfig.timeframe}, Indicator: ${customConfig.indicatorName}`,
    );

    // Enhanced browser launch with error handling
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: customConfig.headless,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-web-security",
          "--disable-features=VizDisplayCompositor",
        ],
        timeout: 30000,
      });
      currentBrowser = browser; // Store reference for stopping
    } catch (browserError) {
      console.error("❌ Failed to launch browser:", browserError.message);
      throw new Error(`Browser launch failed: ${browserError.message}`);
    }
    const page = await browser.newPage();
    const cookiesPath = "./cookies.json";
    if (fs.existsSync(cookiesPath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiesPath));
      await page.setCookie(...cookies);
    }

    console.log("Step 1: Configuring TradingView chart settings...");
    await page.goto(config.baseUrl);
    const buttonSelector = getButtonSelector(customConfig.timeframe);
    await page.waitForSelector(buttonSelector, { timeout: 10000 });
    await page.click(buttonSelector);
    await page.waitForSelector(config.saveButtonSelector, { timeout: 10000 });
    await page.click(config.saveButtonSelector);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await page.close();

    console.log("Step 2: Setting up network interception...");
    const newPage = await browser.newPage();
    await newPage.setRequestInterception(true);
    let targetResponseBody = null;
    newPage.on("request", (request) => request.continue());
    newPage.on("response", async (response) => {
      if (
        response.request().resourceType() === "xhr" &&
        response.request().url().includes(config.targetRequestUrl)
      ) {
        targetResponseBody = await response.text();
      }
    });

    console.log("Step 3: Fetching BSE market data...");
    await newPage.goto(config.bseUrl);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    let processedData = [];
    if (targetResponseBody !== null) {
      const stocks = JSON.parse(targetResponseBody).Table;
      console.log(
        `Found ${stocks.length} stocks. Processing in batches of ${customConfig.batchSize}...`,
      );

      for (let i = 0; i < stocks.length; i += customConfig.batchSize) {
        const stockBatch = stocks.slice(i, i + customConfig.batchSize);
        console.log(
          `Processing batch ${
            Math.floor(i / customConfig.batchSize) + 1
          }/${Math.ceil(stocks.length / customConfig.batchSize)}`,
        );

        const batchPromises = stockBatch.map(async (stock) => {
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

            // In live mode, immediately add breakout stocks to the global array
            if (isLiveMode && stockResult.isBreakout === true) {
              // Check if stock is not already in the array (avoid duplicates)
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
            // Enhanced error handling for various Puppeteer errors
            const errorMessage = error.message || error.toString();
            if (
              errorMessage.includes("frame got detached") ||
              errorMessage.includes("Protocol error") ||
              errorMessage.includes("Connection closed") ||
              errorMessage.includes("Target closed") ||
              errorMessage.includes("Session closed")
            ) {
              console.log(
                `⚠️  Skipping ${scripname} due to connection/frame error: ${errorMessage}`,
              );
            } else {
              console.log(
                `⚠️  Skipping ${scripname} due to error: ${errorMessage}`,
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

        const processedBatch = await Promise.all(batchPromises);
        processedData.push(...processedBatch);
      }
    } else {
      console.log("Target BSE API request not found.");
    }

    await newPage.close();
    await browser.close();
    currentBrowser = null; // Clear reference

    const finalBreakoutStocks = processedData.filter(
      (stock) => stock.isBreakout === true,
    );
    console.log(
      `Scraping complete. Found ${finalBreakoutStocks.length} breakout stocks out of ${processedData.length} processed.`,
    );

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
    if (currentBrowser) {
      await currentBrowser.close();
      currentBrowser = null;
    }
    throw error;
  }
};

// SCRAPER RUNNER - FILE MODE
const runScraper = async (customConfig) => {
  isCurrentlyProcessing = true;
  try {
    const scrapedBreakoutStocks = await main(customConfig);
    if (scrapedBreakoutStocks.length === 0) {
      return {
        success: true,
        mode: "file",
        message: "No breakout stocks found.",
        fileName: null,
        breakoutStocks: 0,
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

// API endpoint to stop the scraper
app.post("/api/stop-scraper", async (req, res) => {
  try {
    if (!isCurrentlyProcessing) {
      return res.status(400).json({
        success: false,
        message: "No scraper is currently running",
      });
    }

    console.log("🛑 Stop request received. Attempting to stop scraper...");

    // Close the browser if it exists
    if (currentBrowser) {
      await currentBrowser.close();
      currentBrowser = null;
      console.log("✅ Browser closed successfully");
    }

    // Reset processing flag
    isCurrentlyProcessing = false;

    res.json({
      success: true,
      message: "Scraper stopped successfully",
    });
  } catch (error) {
    console.error("Error stopping scraper:", error);
    isCurrentlyProcessing = false; // Reset flag even on error
    currentBrowser = null;
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
