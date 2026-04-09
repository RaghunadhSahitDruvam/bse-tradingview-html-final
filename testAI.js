// testAI.js - Simple AI Test Script
const { analyzeStock } = require("./aiAnalysis.js");

// Mock stock data for testing
const mockStock = {
  scripname: "RELIANCE",
  LONG_NAME: "Reliance Industries Ltd - Test",
  ltradert: "2850.50",
  value: 2800,
  trendline_strength: 1,
  pivot_point_strength: 1,
  ema_strength: 0,
  rs_strength: 1,
  change_percent: "1.80",
  trd_vol: "1500000",
  scrip_cd: "500325",
};

console.log("🧪 AI ANALYSIS TEST");
console.log("=".repeat(50));
console.log("Testing AI connection with mock stock data...\n");

analyzeStock(mockStock)
  .then((result) => {
    console.log("\n" + "=".repeat(50));
    console.log("📋 AI RESPONSE:");
    console.log("=".repeat(50));
    console.log(result);
    console.log("\n" + "=".repeat(50));
    console.log("✅ TEST COMPLETED SUCCESSFULLY");
  })
  .catch((error) => {
    console.error("\n" + "=".repeat(50));
    console.error("❌ TEST FAILED");
    console.error("Error:", error.message);
    console.error("Full error:", error);
  });
