// handleLocalDataWriting.js - Save breakout data to local data folder structure
const fs = require("fs").promises;
const { existsSync } = require("fs");
const path = require("path");

/**
 * Maps indicator name to folder name
 * @param {string} indicatorName - The indicator name (e.g., "TrendLines", "Volumetric-Ulgo")
 * @returns {string} - The folder name (e.g., "trendline", "volumetric")
 */
const getIndicatorFolderName = (indicatorName) => {
  const map = {
    TrendLines: "trendline",
    "Volumetric-Ulgo": "volumetric",
  };
  return map[indicatorName] || "unknown";
};

/**
 * Maps timeframe code to folder name
 * @param {string} timeframe - The timeframe code (e.g., "15m", "30m", "2h")
 * @returns {string} - The folder name (e.g., "15min", "30min", "2h")
 */
const getTimeframeFolderName = (timeframe) => {
  const map = {
    "15m": "15min",
    "30m": "30min",
    "2h": "2h",
    "1d": "1d",
    "1w": "1w",
    "1m": "1m",
  };
  return map[timeframe] || timeframe;
};

/**
 * Saves breakout stocks to local data folder
 * @param {Array} breakoutStocks - Array of breakout stock objects
 * @param {string} indicatorName - The indicator name
 * @param {string} timeframe - The timeframe code
 * @returns {Promise<string>} - The path where data was saved
 */
const saveToLocalDataFolder = async (
  breakoutStocks,
  indicatorName,
  timeframe
) => {
  const indicatorFolder = getIndicatorFolderName(indicatorName);
  const timeframeFolder = getTimeframeFolderName(timeframe);

  // Use __dirname to get the directory of this file, then navigate to data folder
  const dataDir = path.join(
    __dirname,
    "data",
    indicatorFolder,
    timeframeFolder
  );
  const dataPath = path.join(dataDir, "data.json");

  // Create directory if it doesn't exist
  if (!existsSync(dataDir)) {
    await fs.mkdir(dataDir, { recursive: true });
    console.log(`📁 Created directory: ${dataDir}`);
  }

  const dataToSave = {
    timestamp: new Date().toISOString(),
    indicator: indicatorName,
    timeframe: timeframe,
    timeframeFolder: timeframeFolder,
    totalBreakouts: breakoutStocks.length,
    stocks: breakoutStocks,
  };

  await fs.writeFile(dataPath, JSON.stringify(dataToSave, null, 2), "utf-8");
  console.log(
    `✅ Saved ${breakoutStocks.length} breakout stocks to ${dataPath}`
  );

  return dataPath;
};

/**
 * Gets all saved data from local data folder for a specific indicator and timeframe
 * @param {string} indicatorName - The indicator name
 * @param {string} timeframe - The timeframe code
 * @returns {Promise<Object|null>} - The saved data or null if not found
 */
const getLocalData = async (indicatorName, timeframe) => {
  const indicatorFolder = getIndicatorFolderName(indicatorName);
  const timeframeFolder = getTimeframeFolderName(timeframe);

  const dataPath = path.join(
    __dirname,
    "data",
    indicatorFolder,
    timeframeFolder,
    "data.json"
  );

  if (!existsSync(dataPath)) {
    return null;
  }

  try {
    const data = await fs.readFile(dataPath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading data from ${dataPath}:`, error.message);
    return null;
  }
};

module.exports = {
  saveToLocalDataFolder,
  getLocalData,
  getIndicatorFolderName,
  getTimeframeFolderName,
};
