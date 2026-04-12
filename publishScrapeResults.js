const fs = require("fs").promises;
const path = require("path");

const PUBLISHED_DATA_DIR = path.join(__dirname, "published-data");

const formatPublishedDate = (date = new Date()) => {
  return `${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}`;
};

const publishScrapeResults = async (stocks, options = {}) => {
  const now = new Date();
  const dateLabel = formatPublishedDate(now);
  const payload = {
    generatedAt: now.toISOString(),
    date: dateLabel,
    indicator: options.indicatorName || null,
    timeframe: options.timeframe || null,
    totalBreakouts: Array.isArray(stocks) ? stocks.length : 0,
    stocks: Array.isArray(stocks) ? stocks : [],
  };

  await fs.mkdir(PUBLISHED_DATA_DIR, { recursive: true });

  const datedJsonPath = path.join(PUBLISHED_DATA_DIR, `${dateLabel}.json`);
  const latestJsonPath = path.join(PUBLISHED_DATA_DIR, "latest.json");

  await fs.writeFile(datedJsonPath, JSON.stringify(payload, null, 2), "utf-8");
  await fs.writeFile(latestJsonPath, JSON.stringify(payload, null, 2), "utf-8");

  return {
    dateLabel,
    datedJsonPath,
    latestJsonPath,
  };
};

module.exports = {
  publishScrapeResults,
  PUBLISHED_DATA_DIR,
  formatPublishedDate,
};
