# BSE TradingView Stocks Scraper

A configurable Node.js application that scrapes BSE (Bombay Stock Exchange) data and integrates it with TradingView analysis for different timeframes.

## Features

- **Multi-timeframe Support**: 5 minutes, 15 minutes, 2 hours, daily, weekly, and monthly
- **Configurable Indicators**: Support for different technical indicators
- **Automated File Generation**: Creates TypeScript data files and Next.js pages
- **TradingView Integration**: Fetches additional data from TradingView charts
- **Git Integration**: Automatically commits and pushes changes
- **Batch Processing**: Processes stocks in configurable batches for better performance

## Project Structure

```
bse-tradingview-stocks/
├── main.js                 # Main application entry point
├── config.js              # Configuration settings
├── handleWriteFile.js     # File writing and page generation
├── tv.js                  # TradingView data fetcher (placeholder)
├── package.json           # Dependencies
└── README.md              # This file
```

## Configuration

### Timeframes

Edit the `SCRAPING_CONFIG` object in `main.js` to configure:

```javascript
const SCRAPING_CONFIG = {
  timeframe: "1d", // Options: "5mi", "15m", "2h", "1d", "1w", "1m"
  indicatorName: "TrendLines", // Must be one of: config.indicatorNames
  batchSize: 5, // Number of stocks to process in parallel
  headless: false, // Set to true for production
};
```

### Indicator Names

All available indicator names are defined in `config.js`:

```javascript
const config = {
  indicatorNames: ["TrendLines", "Volumetric-Ulgo"],
  // ...
};
```

The application will only accept indicator names from this array. To add new indicators, update the `indicatorNames` array in `config.js`.

### Button Selectors

All TradingView button selectors are configured in `config.js`. You can update any selector:

```javascript
const config = {
  dailyButtonSelector: "your-new-selector-here",
  // ... other selectors
};
```

## Usage

### 1. Install Dependencies

```bash
npm install
```

### 2. TradingView Implementation

The `tv.js` file contains a fully functional TradingView scraper template that:

- **Uses cookies.json** for TradingView authentication
- **Navigates to individual stock pages** using BSE symbols
- **Configures timeframes dynamically** based on your SCRAPING_CONFIG
- **Uses indicator selectors** from config.js based on the selected indicator
- **Extracts breakout values** and technical analysis data
- **Calculates strength indicators** (trendline, pivot point, EMA, RS)

The function signature includes the scrapingConfig parameter:

```javascript
const fetch_tv_data = async (
  browser,
  scripname,
  ltradert,
  LONG_NAME,
  scrapingConfig
) => {
  // Your TradingView scraping implementation
  // scrapingConfig contains all configuration including selectors:
  // {
  //   timeframe, indicatorName, batchSize, headless,
  //   canvasSelector, timeframeSelector, indicatorSelectors, baseConfig
  // }
  return {
    value: breakoutValue,
    isBreakout: boolean,
    comp_name: companyData,
    current_market_price: number,
    trendline_strength: 0 | 1,
    pivot_point_strength: 0 | 1,
    ema_strength: 0 | 1,
    rs_strength: 0 | 1 | null,
  };
};
```

### 3. How the Template Works

The scraper automatically adapts based on your configuration. All configuration values are passed through the `scrapingConfig` parameter:

#### Configuration Flow

```javascript
// main.js prepares complete configuration
const completeConfig = {
  ...SCRAPING_CONFIG, // timeframe, indicatorName, etc.
  canvasSelector: config.canvasSelector, // Canvas selector
  timeframeSelector: getButtonSelector(timeframe), // Dynamic timeframe button
  indicatorSelectors: config.indicators[indicatorName], // Dynamic indicator selectors
  baseConfig: config, // Full config for reference
};

// tv.js receives all values via scrapingConfig
const {
  timeframe,
  indicatorName,
  canvasSelector,
  timeframeSelector,
  indicatorSelectors,
  baseConfig,
} = scrapingConfig;
```

#### Dynamic Indicator Selection

```javascript
// tv.js automatically uses the correct selectors
const trendlineValueSelector = indicatorSelectors.selector;
const timestampSelector = indicatorSelectors.timeStampSelector;

// For TrendLines: uses config.indicators.TrendLines.selector
// For Volumetric-Ulgo: uses config.indicators["Volumetric-Ulgo"].selector
```

### 4. Configure Paths

Update the paths in `handleWriteFile.js` to match your frontend project structure:

```javascript
const trendLevelDataDir = `YOUR_FRONTEND_PATH/data/trend-level/${timeframeFolderName}`;
const homePagePath = `YOUR_FRONTEND_PATH/app/page.tsx`;
const frontendDir = "YOUR_FRONTEND_PATH";
```

### 5. Run the Application

```bash
node main.js
```

#### File Mode (All timeframes except 5mi)

The application will:

1. Validate your indicator configuration
2. Display available indicators and current selection
3. Launch TradingView with your configured timeframe
4. Process stocks using the selected indicator
5. Generate data files and pages
6. Commit changes to git (if enabled)

#### Live Mode (5mi timeframe only)

When `timeframe: "5mi"` is set, the application runs in live mode:

1. Starts an Express server on port 5006
2. Provides real-time breakout data via API endpoints
3. Updates data every 5 minutes automatically
4. No files are generated - data is served live

**Live API Endpoints:**

- `GET /` - Complete response with metadata and breakout data
- `GET /breakouts` - Simple array of breakout stocks (your original format)
- `GET /health` - Health check and status information

**Example API Responses:**

```javascript
// GET http://localhost:5006/
{
  "success": true,
  "timestamp": "2025-01-07T10:30:00.000Z",
  "totalBreakouts": 3,
  "timeframe": "5mi",
  "indicator": "Volumetric-Ulgo",
  "data": [
    {
      "scripname": "RELIANCE",
      "isBreakout": true,
      "breakoutValue": 2450.50,
      "ltradert": 2465.30,
      // ... other stock data
    }
  ]
}

// GET http://localhost:5006/breakouts
[
  {
    "scripname": "RELIANCE",
    "isBreakout": true,
    "breakoutValue": 2450.50,
    // ... other stock data
  }
]
```

## How It Works

1. **Configuration Validation**: Validates indicator names and displays current settings
2. **TradingView Setup**: Navigates to TradingView and configures the chart with the specified timeframe
3. **BSE Data Fetching**: Intercepts BSE API requests to get stock data
4. **Individual Stock Processing**: For each stock:
   - Navigates to TradingView stock page
   - Configures timeframe using dynamic selectors
   - Triggers Alt+D for drawing tools
   - Extracts breakout values using indicator-specific selectors
   - Calculates technical strength indicators
   - Fetches company name data
5. **Breakout Filtering**: Only stocks with `isBreakout: true` are kept for file generation
6. **File Generation**: Creates TypeScript data files and Next.js pages with breakout stocks only
7. **Git Operations**: Commits and pushes changes to your repository

## Customization

### Different Timeframes

To run for different timeframes, modify the `timeframe` in `SCRAPING_CONFIG`:

```javascript
// For 15-minute analysis
const SCRAPING_CONFIG = {
  timeframe: "15m",
  indicatorName: "Volumetric-Ulgo", // Must be one of: config.indicatorNames
  // ...
};
```

### Custom Indicators

The `indicatorName` must be one of the values defined in `config.js`:

```javascript
// config.js
const config = {
  indicatorNames: ["TrendLines", "Volumetric-Ulgo"],
  // ...
};
```

Change the `indicatorName` to one of the valid options:

```javascript
const SCRAPING_CONFIG = {
  indicatorName: "TrendLines", // Must be: "TrendLines" or "Volumetric-Ulgo"
  // ...
};
```

The application will validate the indicator name at startup and show an error if an invalid name is used.

### Batch Processing

Adjust `batchSize` based on your system performance:

```javascript
const SCRAPING_CONFIG = {
  batchSize: 10, // Process 10 stocks at once
  // ...
};
```

## Generated Files

The application creates:

- **Data Files**: `/data/trend-level/{timeframe}/{date}.ts`
- **Pages**: `/app/trend-level/{timeframe}/{date}/page.tsx`
- **Updates**: Home page with new navigation buttons

## Environment Variables

Optional environment variables:

- `AUTO_COMMIT=false` - Disable automatic git operations

## Error Handling

The application includes comprehensive error handling:

- Individual stock processing errors won't stop the entire batch
- Git operation failures are logged but don't crash the application
- Network timeouts are handled gracefully

## Next Steps

1. Replace the placeholder `tv.js` with your actual TradingView scraping implementation
2. Update the file paths to match your frontend structure
3. Test with a small batch size first
4. Configure your cron job or scheduler to run at desired intervals

## Support

For issues or questions, ensure all dependencies are installed and paths are correctly configured for your environment.
