// aiAnalysis.js - AI Stock Analysis Module
const OpenAI = require("openai");

const megallmBaseUrl =
  process.env.MEGALLM_BASE_URL || "https://ai.megallm.io/v1";
const megallmApiKey =
  process.env.MEGALLM_API_KEY ||
  "sk-mega-3f1fdf9accc42637c174128d3b3e799ac306d48700a31f69ef05e8c746881da7";

// Initialize OpenAI client with custom base URL
const openai = new OpenAI({
  baseURL: megallmBaseUrl,
  apiKey: megallmApiKey,
});

// System prompt for short-term trading analysis (1-15 days)
const SYSTEM_PROMPT = `📌 SHORT-TERM BREAKOUT TRADING ANALYSIS

You are a world-class equity research analyst and technical analyst specializing in SHORT-TERM TRADING (1-15 days holding period) for Indian stock markets (NSE/BSE).

Your task is to analyze the given BREAKOUT stock and provide a STRICT, STRUCTURED output for short-term trading decisions.

ANALYSIS FRAMEWORK:
1. Evaluate the breakout strength using provided technical indicators
2. Assess fundamental health for short-term momentum
3. Analyze recent catalysts and news sentiment
4. Calculate risk-reward ratio for 1-15 day holding
5. Determine optimal entry and exit points

FUNDAMENTAL QUICK CHECK:
• Revenue & Profit Growth trends (recent quarters)
• Debt levels and liquidity position
• Recent earnings surprises or disappointments
• Any major news/catalysts in last 30 days
• Sector momentum and market sentiment

TECHNICAL BREAKOUT VALIDATION:
• Confirm breakout with volume analysis
• Check support/resistance levels
• Evaluate momentum indicators (RSI, MACD)
• Assess trend strength from provided indicators

⚠️ STRICT OUTPUT FORMAT - YOU MUST RESPOND EXACTLY IN THIS FORMAT:

1) SHOULD I INVEST IN THIS STOCK?: [YES/NO]
   Reason: [One line explanation]

2) HOLDING PERIOD: [X days] (between 1-15 days)
   Reason: [One line explanation]

3) BUYING PRICE: ₹[price]
   (Current price or suggested entry level)

4) TARGET SELLING PRICE: ₹[price]
   Expected Return: [X]%

5) STOP LOSS: ₹[price]
   Risk: [X]%

6) RISK-REWARD RATIO: [X:X]

7) CONFIDENCE LEVEL: [HIGH/MEDIUM/LOW]
   Reason: [One line explanation]

8) KEY RISKS: [2-3 bullet points]

DO NOT deviate from this format. Keep responses concise and actionable for traders.`;

/**
 * Analyzes a breakout stock using AI
 * @param {Object} stockData - Stock data with all parsed values
 * @returns {Promise<string>} - AI analysis as formatted string
 */
const analyzeStock = async (stockData) => {
  const {
    scripname,
    LONG_NAME,
    ltradert,
    value,
    trendline_strength,
    pivot_point_strength,
    ema_strength,
    rs_strength,
    change_percent,
    trd_vol,
    scrip_cd,
  } = stockData;

  console.log(
    `\n🤖 [AI ANALYSIS] Starting analysis for: ${LONG_NAME || scripname}`,
  );
  console.log(`   📊 Current Price: ₹${ltradert}`);
  console.log(`   📈 Breakout Value: ₹${value}`);
  console.log(`   📉 Change %: ${change_percent}%`);

  const userPrompt = `🚨 BREAKOUT ALERT - SHORT-TERM TRADING ANALYSIS REQUIRED

STOCK DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Stock Symbol: ${scripname}
• Company Name: ${LONG_NAME}
• Current Market Price (LTP): ₹${ltradert}
• Breakout Price Level: ₹${value}
• Price Change Today: ${change_percent}%
• Trading Volume: ${trd_vol}
• Script Code: ${scrip_cd}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TECHNICAL INDICATORS (from TradingView):
• Trendline Strength: ${trendline_strength === 0 ? "WEAK 🔴" : "STRONG ⭐"}
• Pivot Point Strength: ${pivot_point_strength === 0 ? "WEAK 🔴" : "STRONG ⭐"}
• EMA Strength: ${ema_strength === 0 ? "WEAK 🔴" : "STRONG ⭐"}
• Relative Strength (RS): ${
    rs_strength === null ? "N/A" : rs_strength === 0 ? "WEAK 🔴" : "STRONG ⭐"
  }

BREAKOUT CONTEXT:
This stock has JUST broken above a significant resistance/trendline level. The current price (₹${ltradert}) is trading above the breakout level (₹${value}).

Provide your SHORT-TERM (1-15 days) trading recommendation in the STRICT FORMAT specified.`;

  try {
    console.log(`   ⏳ Sending request to AI model (gpt-4o)...`);
    const startTime = Date.now();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    });

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    const analysis =
      completion.choices[0]?.message?.content || "Analysis not available";

    console.log(`   ✅ AI analysis completed in ${duration}s`);
    console.log(`   📝 Response length: ${analysis.length} characters`);

    return analysis;
  } catch (error) {
    console.error(
      `   ❌ AI analysis failed for ${scripname}: ${error.message}`,
    );
    return `AI Analysis Error: ${error.message}`;
  }
};

/**
 * Analyzes multiple breakout stocks sequentially
 * @param {Array} breakoutStocks - Array of breakout stock objects
 * @returns {Promise<Array>} - Array of stocks with ai_analysis property added
 */
const analyzeBreakoutStocks = async (breakoutStocks) => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `🤖 AI ANALYSIS MODULE - Processing ${breakoutStocks.length} breakout stocks`,
  );
  console.log(`${"=".repeat(60)}`);

  const analyzedStocks = [];

  for (let i = 0; i < breakoutStocks.length; i++) {
    const stock = breakoutStocks[i];
    console.log(
      `\n📌 [${i + 1}/${breakoutStocks.length}] Processing: ${
        stock.LONG_NAME || stock.scripname
      }`,
    );

    try {
      const aiAnalysis = await analyzeStock(stock);
      analyzedStocks.push({
        ...stock,
        ai_analysis: aiAnalysis,
      });
      console.log(`   ✅ Successfully added AI analysis`);
    } catch (error) {
      console.error(`   ❌ Failed to analyze: ${error.message}`);
      analyzedStocks.push({
        ...stock,
        ai_analysis: `Analysis failed: ${error.message}`,
      });
    }

    // Small delay between API calls to avoid rate limiting
    if (i < breakoutStocks.length - 1) {
      console.log(`   ⏳ Waiting 1s before next analysis...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `✅ AI ANALYSIS COMPLETE - Processed ${analyzedStocks.length} stocks`,
  );
  console.log(`${"=".repeat(60)}\n`);

  return analyzedStocks;
};

module.exports = { analyzeStock, analyzeBreakoutStocks };
