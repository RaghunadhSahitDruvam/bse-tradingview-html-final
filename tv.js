// tv.js - TradingView Data Fetcher

// Required dependencies
const fs = require("fs");
const { timeout } = require("puppeteer");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const axios = require("axios");

// Enable stealth mode for puppeteer
puppeteer.use(StealthPlugin());

// Module-level cache for company name API responses — avoids repeat calls
// for the same name across different stocks in a single run.
const nameCache = new Map();

/**
 * Parse a TradingView timestamp string into a Date at local midnight.
 * Handles common formats like:
 * - YYYY-MM-DD (optionally with time)
 * - YYYYMMDD
 * - DD-MM-YYYY / DDMMYYYY
 * - "28 Feb 2026" / "Feb 28, 2026" (optionally with time)
 *
 * Returns null if it can't be parsed safely.
 */
function parseTvTimestampToLocalMidnight(timestampText) {
  if (!timestampText || typeof timestampText !== "string") return null;
  const raw = timestampText.trim();
  if (!raw) return null;

  // Strip surrounding quotes if present (handles cases like ""20,260,227.00"")
  const stripped = raw.replace(/^["']|["']$/g, "");

  // Check if the text is a numeric value (with or without commas/decimals)
  // This handles cases where the selector returns a price or other numeric value instead of a date
  const numericPattern = /^[\d,]+\.?\d*$/;
  if (numericPattern.test(stripped.replace(/,/g, ""))) {
    // This is a numeric value, not a date string
    return null;
  }

  const cleaned = stripped.replace(/[,]/g, " ").replace(/\s+/g, " ").trim();

  // 1) Look for numeric year-first patterns: YYYY-MM-DD / YYYY/MM/DD / YYYYMMDD...
  const ymd = cleaned.match(
    /(?:^|[^\d])((?:19|20)\d{2})[^\d]?(\d{1,2})[^\d]?(\d{1,2})(?:[^\d]|$)/,
  );
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return new Date(y, m - 1, d);
  }

  // 2) Look for numeric day-first patterns: DD-MM-YYYY / DD/MM/YYYY / DDMMYYYY...
  const dmy = cleaned.match(
    /(?:^|[^\d])(\d{1,2})[^\d]?(\d{1,2})[^\d]?((?:19|20)\d{2})(?:[^\d]|$)/,
  );
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    const y = Number(dmy[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return new Date(y, m - 1, d);
  }

  // 3) Month-name patterns: "28 Feb 2026" / "Feb 28 2026"
  const monthMap = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };

  const dMonY = cleaned.match(
    /(?:^|\s)(\d{1,2})\s+([A-Za-z]{3,9})\s+((?:19|20)\d{2})(?:\s|$)/,
  );
  if (dMonY) {
    const d = Number(dMonY[1]);
    const mon = dMonY[2].toLowerCase();
    const y = Number(dMonY[3]);
    const m = monthMap[mon];
    if (m !== undefined && d >= 1 && d <= 31) return new Date(y, m, d);
  }

  const monDdY = cleaned.match(
    /(?:^|\s)([A-Za-z]{3,9})\s+(\d{1,2})\s+((?:19|20)\d{2})(?:\s|$)/,
  );
  if (monDdY) {
    const mon = monDdY[1].toLowerCase();
    const d = Number(monDdY[2]);
    const y = Number(monDdY[3]);
    const m = monthMap[mon];
    if (m !== undefined && d >= 1 && d <= 31) return new Date(y, m, d);
  }

  // 4) Last resort: Date.parse (can still fail depending on locale/format)
  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime()))
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());

  return null;
}

function toYmdLocal(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ymdToLocalMidnight(ymdStr) {
  if (!ymdStr || typeof ymdStr !== "string") return null;
  const m = ymdStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Fetches trading data from TradingView for a given stock
 * @param {Object} browser - Puppeteer browser instance
 * @param {string} scripname - Stock symbol
 * @param {number} ltradert - Last traded price
 * @param {string} LONG_NAME - Full company name
 * @param {Object} scrapingConfig - Complete configuration object with all selectors and settings
 * @returns {Object} Trading data including breakout status, value and company name
 */
const fetch_tv_data = async (
  browser,
  scripname,
  ltradert,
  LONG_NAME,
  scrapingConfig,
  dateSelection = "today",
) => {
  const page = await browser.newPage();

  // Extract all configuration values from scrapingConfig
  const {
    timeframe,
    indicatorName,
    canvasSelector,
    timeframeSelector,
    indicatorSelectors,
    baseConfig,
    LIVE_MODE,
  } = scrapingConfig;

  // Load saved cookies if they exist
  const cookiesPath = "./cookies.json";
  if (fs.existsSync(cookiesPath)) {
    const cookies = JSON.parse(fs.readFileSync(cookiesPath));
    await page.setCookie(...cookies);
  }

  // Block images, media, fonts, stylesheets and analytics requests to
  // speed up page load significantly (~60-70% faster per stock).
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const resourceType = req.resourceType();
    const url = req.url();
    if (
      ["image", "media", "font", "stylesheet"].includes(resourceType) ||
      url.includes("google-analytics") ||
      url.includes("doubleclick") ||
      url.includes("googlesyndication") ||
      url.includes("amplitude") ||
      url.includes("segment.io")
    ) {
      req.abort();
    } else {
      req.continue();
    }
  });

  try {
    // Navigate to TradingView chart page with enhanced error handling
    try {
      // Optimize page loading with faster wait condition
      await page.goto(
        `https://in.tradingview.com/chart/yenE16ib/?symbol=BSE%3A${scripname}`,
        { waitUntil: "domcontentloaded", timeout: 20000 },
      );
    } catch (navigationError) {
      const errorMessage =
        navigationError.message || navigationError.toString();
      if (
        errorMessage.includes("frame got detached") ||
        errorMessage.includes("Protocol error") ||
        errorMessage.includes("Connection closed") ||
        errorMessage.includes("Target closed") ||
        errorMessage.includes("Session closed") ||
        errorMessage.includes("Navigation timeout")
      ) {
        console.log(
          `⚠️  Navigation error for ${scripname}: ${errorMessage}. Skipping...`,
        );
      } else {
        console.log(
          `⚠️  Failed to navigate to ${scripname}: ${errorMessage}. Skipping...`,
        );
      }

      try {
        await page.close();
      } catch (closeError) {
        console.log(`Warning: Could not close page for ${scripname}`);
      }
      return {
        isBreakout: null,
        value: null,
        comp_name: LONG_NAME,
        current_market_price: parseFloat(ltradert) || 0,
        trendline_strength: 0,
        pivot_point_strength: 0,
        ema_strength: 0,
        rs_strength: 0,
      };
    }

    try {
      // Wait for chart elements to load and switch to specified timeframe
      await page.waitForSelector(canvasSelector, { timeout: 8000 });
      await page.waitForSelector(timeframeSelector, { timeout: 8000 });
      await page.click(timeframeSelector);

      // Trigger drawing tool shortcut (Alt + D)
      await page.keyboard.down("Alt");
      await page.keyboard.press("KeyD");
      await page.keyboard.up("Alt");

      // Reduced wait time for indicators to load
      await new Promise((resolve) => setTimeout(resolve, 2000));
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
          `⚠️  Connection error while loading selectors for ${scripname}: ${errorMessage}. Skipping...`,
        );
      } else {
        console.log(
          `⚠️  Failed to find selectors for ${scripname}: ${errorMessage}. Skipping...`,
        );
      }

      try {
        await page.close();
      } catch (closeError) {
        console.log(`Warning: Could not close page for ${scripname}`);
      }
      return {
        isBreakout: null,
        value: null,
        comp_name: LONG_NAME,
        current_market_price: parseFloat(ltradert) || 0,
        trendline_strength: 0,
        pivot_point_strength: 0,
        ema_strength: 0,
        rs_strength: 0,
      };
    }

    let value = null;
    let isBreakout = null;

    try {
      // Use dynamic selectors based on indicator configuration
      const valueSelector = indicatorSelectors.selector;
      const timestampSelector = indicatorSelectors.timeStampSelector;

      // Extract trendline value and timestamp
      await page.waitForSelector(valueSelector, { timeout: 8000 });
      const valueText = await page.$eval(valueSelector, (element) =>
        element.textContent.trim(),
      );
      const timestampText = await page.$eval(timestampSelector, (element) =>
        element.textContent.trim(),
      );

      // Parse timestamp safely (TradingView timestamp formats can vary a lot)
      const indicatorDate = parseTvTimestampToLocalMidnight(timestampText);

      // Determine which date to compare against based on user selection
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const currentDateStr = toYmdLocal(today);
      const yesterdayDateStr = toYmdLocal(yesterday);

      const selectedDate =
        dateSelection === "yesterday" ? yesterdayDateStr : currentDateStr;

      // Calculate breakout condition
      value = parseFloat(valueText);

      if (indicatorName === "TrendLines") {
        const indicatorDateStr = indicatorDate ? toYmdLocal(indicatorDate) : "";
        if (!indicatorDate) {
          // If timestamp couldn't be parsed, use the selected date as fallback
          // This handles cases where the selector returns numeric data instead of dates
          console.log(
            `⚠️  Could not parse indicator timestamp: "${timestampText}" - Using selected date: ${selectedDate}`,
          );
          isBreakout = ltradert > value;
        } else {
          console.log(
            indicatorDateStr,
            selectedDate,
            `(Using ${dateSelection})`,
          );
          isBreakout =
            !!indicatorDate &&
            ltradert > value &&
            indicatorDateStr === selectedDate;
        }
      } else if (indicatorName === "Volumetric-Ulgo") {
        const selectedDateObj = ymdToLocalMidnight(selectedDate);
        let isCurrentDateInRange = false;
        let twoDaysLater = null;

        if (indicatorDate && selectedDateObj) {
          // Create the end of the date range without modifying the original indicatorDate.
          twoDaysLater = new Date(indicatorDate);
          // Add 7 days to the copy.
          twoDaysLater.setDate(twoDaysLater.getDate() + 7);

          // Perform the date range check using only Date objects.
          isCurrentDateInRange =
            selectedDateObj >= indicatorDate && selectedDateObj <= twoDaysLater;
        }

        if (!indicatorDate || !selectedDateObj) {
          // If timestamp couldn't be parsed, assume the indicator is from today
          // This handles cases where the selector returns numeric data instead of dates
          console.log(
            `⚠️  Could not parse indicator timestamp: "${timestampText}" - Assuming indicator is from today`,
          );
          // When we can't parse the timestamp, we assume the indicator is current
          // and check if the price condition is met
          isCurrentDateInRange = true;
        } else {
          console.log(
            selectedDateObj,
            indicatorDate,
            twoDaysLater,
            `(Using ${dateSelection})`,
          );
        }

        let percent = LIVE_MODE ? 0.05 : 0.08;
        const upperBound = value * percent + value;

        isBreakout =
          ltradert > value && ltradert <= upperBound && isCurrentDateInRange;
      }
    } catch (error) {
      console.log(
        `Failed to retrieve breakout value for ${scripname} with ${indicatorName}. Setting breakout info to null. Error: ${error.message}`,
      );
    }

    // Get formatted company name (optimized with timeout and fallback)
    let companyName = LONG_NAME.split(" - ")[0]; // Use original name as fallback
    try {
      // Format company name by removing common suffixes and special characters
      const formattedName = companyName
        .replaceAll("Ltd", "limited")
        .replaceAll("LTD", "limited")
        .replaceAll(".", " ")
        .replaceAll("-$", " ")
        .replaceAll("{", "")
        .replaceAll("}", "")
        .replaceAll("(", "")
        .replaceAll(")", "")
        .replaceAll("&", "and");

      if (nameCache.has(formattedName)) {
        // Cache hit — skip HTTP call entirely
        companyName = nameCache.get(formattedName);
      } else {
        // Fetch with reduced timeout to prevent blocking
        const response = await Promise.race([
          axios.get(
            `https://miniphinzi.vercel.app/api/convert?name=${encodeURIComponent(
              formattedName,
            )}`,
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), 1500),
          ),
        ]);
        companyName = response.data;
        nameCache.set(formattedName, companyName);
      }
    } catch (err) {
      // Silently fail without console error to reduce noise
      companyName = LONG_NAME.split(" - ")[0]; // Use original name as fallback
    }

    // Selector for trendline strength (optimized with shorter timeout)
    let trendline_strength_value = 0;
    try {
      const trendlineSelector =
        "body > div:nth-of-type(2) > div > div:nth-of-type(6) > div > div:nth-of-type(2) > div:first-of-type > div:nth-of-type(3) > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div > div:nth-of-type(5) > div:nth-of-type(2) > div:nth-of-type(20) > div:nth-of-type(2) > span";

      // Try to find element with shorter timeout
      const elementExists = await page.$(trendlineSelector);
      if (elementExists) {
        const trendline_strength = await page.$eval(
          trendlineSelector,
          (element) => element.textContent.trim(),
        );
        trendline_strength_value = parseFloat(trendline_strength);
      }
    } catch (error) {
      // Trendline strength selector not found, value remains 0
    }

    // Selector for pivot point strength (optimized with shorter timeout)
    let pivot_point_strength_value = 0;
    try {
      const pivotSelector =
        "body > div:nth-of-type(2) > div > div:nth-of-type(6) > div > div:nth-of-type(2) > div:first-of-type > div:nth-of-type(3) > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div > div:nth-of-type(5) > div:nth-of-type(2) > div:nth-of-type(21) > div:nth-of-type(2) > span";

      // Try to find element with shorter timeout
      const elementExists = await page.$(pivotSelector);
      if (elementExists) {
        const pivot_point_strength = await page.$eval(
          pivotSelector,
          (element) => element.textContent.trim(),
        );
        pivot_point_strength_value = parseFloat(pivot_point_strength);
      }
    } catch (error) {
      // Pivot point strength selector not found, value remains 0
    }

    // Selector for EMA strength (optimized with shorter timeout)
    let ema_strength_value = 0;
    try {
      const emaSelector =
        "body > div:nth-of-type(2) > div > div:nth-of-type(6) > div > div:nth-of-type(2) > div:first-of-type > div:nth-of-type(3) > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div > div:nth-of-type(5) > div:nth-of-type(2) > div:nth-of-type(22) > div:nth-of-type(2) > span";

      // Try to find element with shorter timeout
      const elementExists = await page.$(emaSelector);
      if (elementExists) {
        const ema_strength = await page.$eval(emaSelector, (element) =>
          element.textContent.trim(),
        );
        ema_strength_value = parseFloat(ema_strength);
      }
    } catch (error) {
      // EMA strength selector not found, value remains 0
    }

    // Selector for RS strength (optimized with shorter timeout)
    let rs_strength_value = 0;
    try {
      const rsSelector =
        "body > div:nth-of-type(2) > div > div:nth-of-type(6) > div > div:nth-of-type(2) > div:first-of-type > div:nth-of-type(3) > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div > div:nth-of-type(7) > div:nth-of-type(2) > div:nth-of-type(2) > div:nth-of-type(2) > span";

      // Try to find element with shorter timeout
      const elementExists = await page.$(rsSelector);
      if (elementExists) {
        const rs_strength = await page.$eval(rsSelector, (element) =>
          element.textContent.trim(),
        );
        rs_strength_value = parseFloat(rs_strength);
      }
    } catch (error) {
      // RS strength selector not found, value remains 0
    }

    await page.close();

    const result = {
      isBreakout,
      value: value,
      comp_name: companyName,
      current_market_price: parseFloat(ltradert) || 0,
      trendline_strength: trendline_strength_value,
      pivot_point_strength: pivot_point_strength_value,
      ema_strength: ema_strength_value,
      rs_strength: rs_strength_value,
    };

    // Log only when breakout is detected
    if (isBreakout === true) {
      const displayName =
        typeof companyName === "string" &&
        companyName !== "invalid company name"
          ? companyName
          : scripname;
      console.log(`Breakout Detected for ${displayName}`);
    }

    return result;
  } catch (error) {
    // Enhanced error handling for various Puppeteer errors
    const errorMessage = error.message || error.toString();

    if (
      errorMessage.includes("frame got detached") ||
      errorMessage.includes("Protocol error") ||
      errorMessage.includes("Connection closed") ||
      errorMessage.includes("Target closed") ||
      errorMessage.includes("Session closed") ||
      errorMessage.includes("Navigation timeout") ||
      errorMessage.includes("waiting for selector")
    ) {
      console.log(
        `⚠️  Connection/frame error for ${scripname}: ${errorMessage}. Skipping...`,
      );
    } else {
      console.log(
        `⚠️  Error processing ${scripname}: ${errorMessage}. Skipping...`,
      );
    }

    // Safely close the page
    try {
      await page.close();
    } catch (closeError) {
      console.log(`Warning: Could not close page for ${scripname}`);
    }

    return {
      isBreakout: null,
      value: null,
      comp_name: LONG_NAME,
      current_market_price: parseFloat(ltradert) || 0,
      trendline_strength: 0,
      pivot_point_strength: 0,
      ema_strength: 0,
      rs_strength: 0,
    };
  }
};

module.exports = fetch_tv_data;
