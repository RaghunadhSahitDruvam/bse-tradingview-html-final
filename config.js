// config.js
const config = {
  baseUrl: "https://in.tradingview.com/chart/yenE16ib/?symbol=NSE%3Adcm",
  timeframes: ["5mi", "15m", "30m", "2h", "1d", "1w", "1m"],
  canvasSelector:
    "body > div:nth-of-type(2) > div > div:nth-of-type(5) > div:first-of-type > div:first-of-type > div > div:nth-of-type(2) > div:first-of-type > div:nth-of-type(2) > div > canvas:nth-of-type(2)",
  fiveMinuteButtonSelector:
    "body > div:nth-of-type(2) > div > div:nth-of-type(3) > div > div > div:nth-of-type(3) > div:first-of-type > div > div > div > div > div:nth-of-type(4) > div > div > button:first-of-type",
  fifteenMinuteButtonSelector:
    "body > div:nth-of-type(2) > div > div:nth-of-type(3) > div > div > div:nth-of-type(3) > div:first-of-type > div > div > div > div > div:nth-of-type(4) > div > div > button:nth-of-type(2)",

  thirtyMinuteButtonSelector:
    "body > div:nth-of-type(2) > div > div:nth-of-type(3) > div > div > div:nth-of-type(3) > div:first-of-type > div > div > div > div > div:nth-of-type(4) > div > div > button:nth-of-type(3)",
  twoHourButtonSelector:
    "body > div:nth-of-type(2) > div > div:nth-of-type(3) > div > div > div:nth-of-type(3) > div:first-of-type > div > div > div > div > div:nth-of-type(4) > div > div > button:nth-of-type(4)",
  dailyButtonSelector:
    "body > div:nth-of-type(2) > div > div:nth-of-type(3) > div > div > div:nth-of-type(3) > div:first-of-type > div > div > div > div > div:nth-of-type(4) > div > div > button:nth-of-type(5)",
  weeklyButtonSelector:
    "body > div:nth-of-type(2) > div > div:nth-of-type(3) > div > div > div:nth-of-type(3) > div:first-of-type > div > div > div > div > div:nth-of-type(4) > div > div > button:nth-of-type(6)",
  monthlyButtonSelector:
    "body > div:nth-of-type(2) > div > div:nth-of-type(3) > div > div > div:nth-of-type(3) > div:first-of-type > div > div > div > div > div:nth-of-type(4) > div > div > button:nth-of-type(7)",
  saveButtonSelector:
    "body > div:nth-of-type(2) > div > div:nth-of-type(3) > div > div > div:nth-of-type(3) > div:first-of-type > div > div > div > div > div:nth-of-type(14) > div > div > button",
  targetRequestUrl:
    "https://api.bseindia.com/BseIndiaAPI/api/MktRGainerLoserDataeqto/w?GLtype=gainer&IndxGrp=AllMkt&IndxGrpval=AllMkt&orderby=all",
  bseUrl:
    "https://www.bseindia.com/markets/equity/EQReports/mktwatchR.html?filter=gainer*all$all$",
  indicatorNames: ["TrendLines", "Volumetric-Ulgo"],
  indicators: {
    TrendLines: {
      selector:
        "body > div:nth-of-type(2) > div > div:nth-of-type(6) > div > div:nth-of-type(2) > div:first-of-type > div:nth-of-type(3) > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div > div:nth-of-type(5) > div:nth-of-type(2) > div:nth-of-type(12) > div:nth-of-type(2) > span",
      timeStampSelector:
        "body > div:nth-of-type(2) > div > div:nth-of-type(6) > div > div:nth-of-type(2) > div:first-of-type > div:nth-of-type(3) > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div > div:nth-of-type(5) > div:nth-of-type(2) > div:nth-of-type(16) > div:nth-of-type(2) > span",
    },
    "Volumetric-Ulgo": {
      selector:
        "body > div:nth-of-type(2) > div > div:nth-of-type(6) > div > div:nth-of-type(2) > div:first-of-type > div:nth-of-type(3) > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div > div:nth-of-type(5) > div:nth-of-type(2) > div:nth-of-type(2) > div:nth-of-type(2) > span",
      timeStampSelector:
        "body > div:nth-of-type(2) > div > div:nth-of-type(6) > div > div:nth-of-type(2) > div:first-of-type > div:nth-of-type(3) > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div > div:nth-of-type(5) > div:nth-of-type(2) > div:nth-of-type(28) > div:nth-of-type(2) > span",
    },
  },
};

module.exports = { config };
