// tv.js - TradingView Data Fetcher

// Required dependencies
const fs = require("fs");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const axios = require("axios");

// Enable stealth mode for puppeteer
puppeteer.use(StealthPlugin());

const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font"]);
const BLOCKED_URL_PATTERNS = [
  "google-analytics",
  "googletagmanager",
  "doubleclick",
  "facebook.net",
  "analytics",
  "hotjar",
  "sentry",
];

const COOKIES_PATH = process.env.COOKIES_PATH || `${__dirname}/cookies.json`;

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

  // TradingView sometimes emits dates as comma-formatted numbers with a decimal, e.g.
  // "20,260,320.00"  →  20260320  →  YYYYMMDD  →  2026-03-20
  // Try to detect and parse that before treating the value as a plain price.
  const numericPattern = /^[\d,]+\.?\d*$/;
  if (numericPattern.test(stripped)) {
    // Drop commas and the decimal part to get a bare integer string
    const digits = stripped.replace(/,/g, "").replace(/\.\d*$/, "");
    // 8-digit YYYYMMDD
    const yyyymmdd = digits.match(/^((?:19|20)\d{2})(\d{2})(\d{2})$/);
    if (yyyymmdd) {
      const y = Number(yyyymmdd[1]);
      const m = Number(yyyymmdd[2]);
      const d = Number(yyyymmdd[3]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return new Date(y, m - 1, d);
    }
    // Not a date — it's a price or other numeric value
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

function resolveSelectedDate(dateSelection, selectedDate) {
  if (ymdToLocalMidnight(selectedDate)) {
    return selectedDate;
  }

  const today = new Date();
  if (dateSelection === "yesterday") {
    today.setDate(today.getDate() - 1);
  }

  return toYmdLocal(today);
}

async function prepareTradingViewPage(page) {
  if (page.__tvPrepared) {
    return;
  }

  await page.setCacheEnabled(true);
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const resourceType = request.resourceType();
    const requestUrl = request.url().toLowerCase();
    const shouldBlock =
      BLOCKED_RESOURCE_TYPES.has(resourceType) ||
      BLOCKED_URL_PATTERNS.some((pattern) => requestUrl.includes(pattern));

    if (shouldBlock) {
      request.abort();
      return;
    }

    request.continue();
  });

  page.__tvPrepared = true;
}

async function loadCookiesIfPresent(page) {
  if (fs.existsSync(COOKIES_PATH)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH));
    await page.setCookie(...cookies);
  }
}

async function waitForChartToSettle(
  page,
  canvasSelector,
  valueSelector,
  timeoutMs,
) {
  await page.waitForSelector(canvasSelector, { timeout: timeoutMs });
  await page.waitForSelector(valueSelector, { timeout: timeoutMs });
}

/**
 * STRATEGY 1 (fastest): Navigate directly via URL — no UI search needed.
 * TradingView accepts ?symbol=BSE:SCRIPNAME in the URL and reloads the chart.
 * This is the same as changing the symbol from the address bar and is instant.
 */
async function switchSymbolViaUrl(page, scripname) {
  const chartId = "yenE16ib"; // locked chart layout ID
  const targetUrl = `https://in.tradingview.com/chart/${chartId}/?symbol=BSE%3A${scripname}`;
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
}

/**
 * STRATEGY 2: Intercept TradingView's own symbol-search XHR and inject the
 * first result's symbol directly via their internal JS API — completely bypasses
 * the slow search-results dropdown rendering in headless Chromium.
 */
async function switchSymbolViaApiIntercept(page, scripname, baseConfig) {
  const { symbolSearchButtonSelector, symbolSearchInputSelector } = baseConfig;

  // Try to use TradingView's internal chart API to switch the symbol directly
  // without needing the search dropdown to render.
  const switched = await page.evaluate((sym) => {
    try {
      // TradingView exposes a global chart widget on the window
      const tvWidget =
        window.tvWidget ||
        window._tvWidget ||
        (window.TradingView && window.TradingView.widget);
      if (tvWidget && typeof tvWidget.setSymbol === "function") {
        tvWidget.setSymbol(`BSE:${sym}`, null, () => {});
        return true;
      }
      // Try iframe-based widget
      const frames = Array.from(document.querySelectorAll("iframe"));
      for (const f of frames) {
        try {
          const fw = f.contentWindow;
          if (
            fw &&
            fw.tvWidget &&
            typeof fw.tvWidget.setSymbol === "function"
          ) {
            fw.tvWidget.setSymbol(`BSE:${sym}`, null, () => {});
            return true;
          }
        } catch (_) {}
      }
      return false;
    } catch (_) {
      return false;
    }
  }, scripname);

  // Fall back to opening the search UI
  await page.waitForSelector(symbolSearchButtonSelector, { timeout: 10000 });
  await page.click(symbolSearchButtonSelector);
  await page.waitForSelector(symbolSearchInputSelector, { timeout: 10000 });

  // Clear + type using evaluate (sets value directly, bypassing slow key events)
  await page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      nativeInputValueSetter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    symbolSearchInputSelector,
    scripname,
  );

  return false;
}

/**
 * STRATEGY 3 (UI fallback): The original approach but with a 30-second wait
 * window and smarter retry that watches for the XHR to complete first.
 */
async function switchSymbolViaUiFallback(page, scripname, baseConfig) {
  const {
    symbolSearchButtonSelector,
    symbolSearchInputSelector,
    symbolSearchFirstResultSelector,
  } = baseConfig;

  const previousUrl = page.url();

  // Set up an XHR watcher BEFORE opening the search — so we catch the response
  let searchXhrDone = false;
  const searchXhrWatcher = page
    .waitForResponse(
      (res) =>
        res.url().includes("symbol_search") ||
        res.url().includes("search?text=") ||
        res.url().includes("/search?query="),
      { timeout: 30000 },
    )
    .then(() => {
      searchXhrDone = true;
    })
    .catch(() => {});

  await page.waitForSelector(symbolSearchButtonSelector, { timeout: 15000 });
  await page.click(symbolSearchButtonSelector);
  await page.waitForSelector(symbolSearchInputSelector, { timeout: 15000 });

  // Reliable field clear
  await page.click(symbolSearchInputSelector);
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");

  // Type with a moderate delay — not too fast (misses debounce), not too slow
  await page.type(symbolSearchInputSelector, scripname, { delay: 60 });

  // Wait up to 30 seconds total for results to appear
  let resultsLoaded = false;
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline && !resultsLoaded) {
    try {
      await page.waitForSelector(symbolSearchFirstResultSelector, {
        timeout: 5000,
      });

      const hasResults = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el && el.innerText && el.innerText.trim().length > 0;
      }, symbolSearchFirstResultSelector);

      if (hasResults) {
        resultsLoaded = true;
        break;
      }
    } catch (_) {}

    // If XHR already completed but results aren't showing, retype
    if (searchXhrDone && !resultsLoaded) {
      await page.click(symbolSearchInputSelector);
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
      await new Promise((r) => setTimeout(r, 300));
      await page.type(symbolSearchInputSelector, scripname, { delay: 60 });
      searchXhrDone = false;
    }

    await new Promise((r) => setTimeout(r, 800));
  }

  if (!resultsLoaded) {
    throw new Error(
      `[UI Fallback] Symbol search results never appeared for "${scripname}" after 30s`,
    );
  }

  await Promise.allSettled([
    page.waitForFunction(
      (lastUrl) => window.location.href !== lastUrl,
      { timeout: 20000 },
      previousUrl,
    ),
    page.click(symbolSearchFirstResultSelector),
  ]);
}

/**
 * Main symbol switcher — tries the fastest method first, falls back gracefully.
 *
 * When reuseSymbolSearch=true the caller already navigated to the base URL once.
 * We switch symbol using URL navigation (Strategy 1) which is instant and has
 * zero dependency on the search dropdown rendering speed in headless Chromium.
 */
async function switchSymbolWithinTradingView(page, scripname, baseConfig) {
  // Strategy 1: Direct URL navigation — fastest, most reliable in headless Chromium.
  // No search dialog, no waiting for XHR results. Just navigate.
  try {
    await switchSymbolViaUrl(page, scripname);
    return; // success — skip everything else
  } catch (urlErr) {
    console.log(
      `⚠️  [${scripname}] URL strategy failed (${urlErr.message}), trying API intercept...`,
    );
  }

  // Strategy 2: Inject via TradingView's internal JS API (no dropdown needed)
  try {
    const apiWorked = await switchSymbolViaApiIntercept(
      page,
      scripname,
      baseConfig,
    );
    if (apiWorked) return;
  } catch (apiErr) {
    console.log(
      `⚠️  [${scripname}] API intercept strategy failed (${apiErr.message}), using UI fallback...`,
    );
  }

  // Strategy 3: Full UI search with 30-second window
  await switchSymbolViaUiFallback(page, scripname, baseConfig);
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
  pageOrBrowser,
  scripname,
  ltradert,
  LONG_NAME,
  scrapingConfig,
  dateSelection = "today",
) => {
  const shouldReusePage = typeof pageOrBrowser?.goto === "function";
  const page = shouldReusePage ? pageOrBrowser : await pageOrBrowser.newPage();

  // Extract all configuration values from scrapingConfig
  const {
    timeframe,
    indicatorName,
    canvasSelector,
    timeframeSelector,
    indicatorSelectors,
    baseConfig,
    LIVE_MODE,
    selectedDate,
    reuseSymbolSearch,
    openDataWindow,
  } = scrapingConfig;

  await prepareTradingViewPage(page);
  await loadCookiesIfPresent(page);

  try {
    // Navigate to TradingView chart page with enhanced error handling
    try {
      if (reuseSymbolSearch) {
        await switchSymbolWithinTradingView(page, scripname, baseConfig);
      } else {
        await page.goto(
          `https://in.tradingview.com/chart/yenE16ib/?symbol=BSE%3A${scripname}`,
          { waitUntil: "domcontentloaded", timeout: 15000 },
        );
      }
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
      const valueSelector = indicatorSelectors.selector;
      await waitForChartToSettle(page, canvasSelector, valueSelector, 15000);

      if (openDataWindow) {
        await page.keyboard.down("Alt");
        await page.keyboard.press("KeyD");
        await page.keyboard.up("Alt");

        await page.waitForSelector(valueSelector, { timeout: 15000 });
      }
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
      await page.waitForSelector(valueSelector, { timeout: 15000 });
      const valueText = await page.$eval(valueSelector, (element) =>
        element.textContent.trim(),
      );
      const timestampText = await page.$eval(timestampSelector, (element) =>
        element.textContent.trim(),
      );

      // Parse timestamp safely (TradingView timestamp formats can vary a lot)
      const indicatorDate = parseTvTimestampToLocalMidnight(timestampText);

      const effectiveSelectedDate = resolveSelectedDate(
        dateSelection,
        selectedDate,
      );

      // Calculate breakout condition
      value = parseFloat(valueText);

      if (indicatorName === "TrendLines") {
        const indicatorDateStr = indicatorDate ? toYmdLocal(indicatorDate) : "";
        if (!indicatorDate) {
          // If timestamp couldn't be parsed, use the selected date as fallback
          // This handles cases where the selector returns numeric data instead of dates
          console.log(
            `⚠️  Could not parse indicator timestamp: "${timestampText}" - Using selected date: ${effectiveSelectedDate}`,
          );
          isBreakout = ltradert > value;
        } else {
          console.log(
            indicatorDateStr,
            effectiveSelectedDate,
            `(Using ${dateSelection})`,
          );
          isBreakout =
            !!indicatorDate &&
            ltradert > value &&
            indicatorDateStr === effectiveSelectedDate;
        }
      } else if (indicatorName === "Volumetric-Ulgo") {
        const selectedDateObj = ymdToLocalMidnight(effectiveSelectedDate);
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

    // Only resolve the formatted company name for confirmed breakout stocks.
    let companyName = LONG_NAME.split(" - ")[0];
    if (isBreakout === true) {
      try {
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

        const response = await Promise.race([
          axios.get(
            `https://miniphinzi.vercel.app/api/convert?name=${encodeURIComponent(
              formattedName,
            )}`,
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), 3000),
          ),
        ]);
        companyName = response.data;
      } catch (err) {
        companyName = LONG_NAME.split(" - ")[0];
      }
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

    if (!shouldReusePage) {
      await page.close();
    }

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

    if (!shouldReusePage) {
      try {
        await page.close();
      } catch (closeError) {
        console.log(`Warning: Could not close page for ${scripname}`);
      }
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
