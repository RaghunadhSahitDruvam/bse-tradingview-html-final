// handleWriteFile.js
const fs = require("fs").promises;
const { existsSync } = require("fs");
const path = require("path");
const { format } = require("date-fns");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);

const FRONTEND_ROOT =
  process.env.FRONTEND_ROOT ||
  path.join(__dirname, "generated-output", "frontend");

const getFrontendPath = (...segments) => path.join(FRONTEND_ROOT, ...segments);

// Helper function to convert timeframe to folder name
const getTimeframeFolderName = (timeframe) => {
  const timeframeMap = {
    "5mi": "5min",
    "15m": "15min",
    "30m": "30min",
    "2h": "2hour",
    "1d": "daily",
    "1w": "weekly",
    "1m": "monthly",
  };
  return timeframeMap[timeframe] || "daily";
};

// Helper function to get timeframe display name
const getTimeframeDisplayName = (timeframe) => {
  const displayMap = {
    "5mi": "5 Minutes",
    "15m": "15 Minutes",
    "30m": "30 Minutes",
    "2h": "2 Hours",
    "1d": "Daily",
    "1w": "Weekly",
    "1m": "Monthly",
  };
  return displayMap[timeframe] || "Daily";
};

const handleFileWriting = async (data, options = {}) => {
  try {
    const {
      indicatorName = "TrendBreakout",
      timeframe = "1d",
      timestamp = new Date().toISOString(),
      totalStocks = 0,
      config = {},
    } = options;

    const currentDate = format(new Date(), "dd-MM-yy");
    const timeframeFolderName = getTimeframeFolderName(timeframe);
    const timeframeDisplayName = getTimeframeDisplayName(timeframe);

    console.log(
      `Processing ${totalStocks} stocks for ${indicatorName} indicator on ${timeframe} timeframe`,
    );
    if (indicatorName === "Volumetric-Ulgo") {
      // 1. Write data to volumetric data file
      const VolumetricLevelDataDir = getFrontendPath(
        "data",
        "volumetric",
        timeframeFolderName,
      );
      const volumetricDataPath = path.join(
        VolumetricLevelDataDir,
        `${currentDate}.ts`,
      );
      // Create directories if they don't exist
      if (!existsSync(VolumetricLevelDataDir)) {
        await fs.mkdir(VolumetricLevelDataDir, { recursive: true });
      }
      const dataWithMetadata = {
        data: data,
        metadata: {
          indicatorName,
          timeframe,
          timeframeDisplayName,
          timestamp,
          totalStocks,
          generatedDate: currentDate,
          config: {
            baseUrl: config.baseUrl,
            timeframes: config.timeframes,
          },
        },
      };
      const tsCode = `// @ts-nocheck 
    // Generated on: ${timestamp}
    // Indicator: ${indicatorName}
    // Timeframe: ${timeframeDisplayName}
    // Total Stocks: ${totalStocks}
    
    const stockData = ${JSON.stringify(data, null, 2)};
    
    const metadata = ${JSON.stringify(dataWithMetadata.metadata, null, 2)};
    
    export { stockData as data, metadata };
    export default stockData;`;
      await fs.writeFile(volumetricDataPath, tsCode, "utf-8");
      console.log(`Data has been written to ${volumetricDataPath}`);

      // 2. Create trend-level page directory and file
      const volumetricPageDir = getFrontendPath(
        "app",
        "volumetric",
        timeframeFolderName,
        currentDate,
      );
      if (!existsSync(volumetricPageDir)) {
        await fs.mkdir(volumetricPageDir, { recursive: true });
      }

      // 3. Update home page to add new button
      const homePagePath = getFrontendPath("app", "page.tsx");

      try {
        const homePageContent = await fs.readFile(homePagePath, "utf-8");

        // Parse the existing content to find the appropriate timeframe array
        const timeframeProperty = timeframeFolderName;
        const timeframeMatch = homePageContent.match(
          new RegExp(`${timeframeProperty}:\\s*\\[([\\s\\S]*?)\\]`),
        );

        if (timeframeMatch) {
          const existingButtons = timeframeMatch[1].trim();
          const newButton = `\n      { text: "${indicatorName}-${currentDate}", href: "/volumetric/${timeframeFolderName}/${currentDate}" },`;

          // Replace the old array with updated one
          const updatedContent = homePageContent.replace(
            new RegExp(`${timeframeProperty}:\\s*\\[([\\s\\S]*?)\\]`),
            `${timeframeProperty}: [${existingButtons}${newButton}\n    ]`,
          );

          await fs.writeFile(homePagePath, updatedContent, "utf-8");
          console.log(
            `Updated home page with new ${timeframeDisplayName} button`,
          );
        }
      } catch (homePageError) {
        console.warn("Could not update home page:", homePageError.message);
      }

      // 4. Create the trend-level page file
      const pageContent = `import { data, metadata } from "@/data/volumetric/${timeframeFolderName}/${currentDate}";
    import React from "react";
    
    export const revalidate = 0;
    
    const Home = async () => {
      return (
        <div>
          <div className="mb-4 p-4 bg-blue-50 rounded-lg">
            <h1 className="text-2xl font-bold text-blue-800">
              ${indicatorName} Analysis - ${timeframeDisplayName}
            </h1>
            <p className="text-sm text-gray-600">
              Generated on: {metadata.generatedDate} | Total Stocks:{" "}
              {metadata.totalStocks}
            </p>
          </div>
    
          <table className="mt-4 table w-full p-4">
            <thead
              className="rounded-md"
              style={{
                background:
                  "linear-gradient(270deg," + "#20bf55" + "," + "#01baef" + ")",
                position: "sticky",
                top: 0,
                color: "#fff",
                borderRadius: 10,
              }}
            >
              <tr>
                <th className="border border-black ">S.no</th>
                <th className="border border-black">Letters</th>
                <th className="border border-black ">Company Name</th>
                <th className="border border-black">T</th>
                <th className="border border-black">V</th>
                <th className="border border-black">C</th>
                <th className="border border-black text-2xl font-bold">
                  Br. Price
                </th>
                <th className="border border-black text-2xl font-bold">LTP</th>
                <th className="border border-black text-2xl font-bold">Now %</th>
                <th className="border border-black ">Tr.v</th>
                <th className="border border-black ">Z</th>
                <th className="border border-black ">M.C</th>
                <th className="border border-black ">N</th>
                <th className="border border-black ">C.I</th>
                <th className="border border-black ">SC</th>
                <th className="border border-black text-2xl font-bold">Volume</th>
                <th className="border border-black text-2xl font-bold">
                  TrendLine Strength
                </th>
                <th className="border border-black text-2xl font-bold">
                  Pivot Strength
                </th>
                <th className="border border-black text-2xl font-bold">
                  EMA Strength
                </th>
                <th className="border border-black text-2xl font-bold">
                  RS Strength
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Check if data exists before mapping */}
              {Array.isArray(data) &&
                data
                  // Filter for valid breakouts
                  .filter((stock: any) => {
                    const isBreakoutValid = stock.isBreakout === true;
                    const breakoutValue = Number(stock.value); // Use 'value' instead of 'breakoutValue'
                    const ltpValue = Number(stock.ltradert);
                    const isInvalidBreakoutLtpCombo =
                      breakoutValue < 10 && ltpValue >= 100;
                    return isBreakoutValid && !isInvalidBreakoutLtpCombo;
                  })
                  // Map through the filtered data to create table rows
                  .map((item: any, index: any) => {
                    // Use 'comp_name' instead of 'num_data'
                    const innerHtml =
                      typeof item?.comp_name === "object"
                        ? item?.comp_name.name_g2_block
                        : "<p></p>";
                    const innerHtmlg3 =
                      typeof item?.comp_name === "object"
                        ? item?.comp_name.name_g3_block
                        : "<p></p>";
    
                    return (
                      // Use React.Fragment to group the two rows for each stock
                      <React.Fragment key={index}>
                        <tr className="border border-black ">
                          <td className="border border-black text-center"> {index + 1}</td>
                          <td className="border border-black text-center">
                            {item.comp_name?.tot_letters || "N/A"}
                          </td>
                          <td
                            className="border border-black"
                            style={{
                              paddingTop: 10,
                              paddingBottom: 10,
                              paddingLeft: 25,
                              paddingRight: 25,
                              backgroundColor: "#F4F4F4",
                            }}
                          >
                            <table
                              className="text-[#13BD97] font-extrabold"
                              dangerouslySetInnerHTML={{ __html: innerHtml }}
                            ></table>
                          </td>
                          <td className="border border-black text-[#13BD97] font-extrabold px-[7px] text-center">
                            {item.comp_name?.g2tot || "N/A"}
                          </td>
                          <td className="border border-black text-[#13BD97] font-extrabold px-[7px] text-center">
                            {item.comp_name?.g2vtot || "N/A"}
                          </td>
                          <td className="border border-black text-[#13BD97] font-extrabold px-[7px] text-center">
                            {item.comp_name?.g2nettot || "N/A"}
                          </td>
                          <td className="border border-black p-2 text-xl text-center">
                            {item.value}
                          </td>
                          <td className="border border-black text-center">
                            <span className="font-extrabold text-xl text-green-700">
                              {item.ltradert}
                            </span>
                          </td>
                          <td className="border border-black p-2 text-xl text-center">
                            {item.change_percent + " %"}
                          </td>
                          <td className="border border-black text-center">
                            <a
                              href={
                                "https://in.tradingview.com/chart/qmDo3C1P/?symbol=BSE%3A" +
                                item.scripname
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 underline"
                            >
                              qmDo3C1P
                            </a>
                          </td>
                          <td className="border border-black p-2 underline text-blue-500 text-center">
                            <a
                              href={
                                "https://www.google.com/search?q=zauba+" +
                                item.LONG_NAME.split(" - ")[0]
                                  .replaceAll("Ltd", "limited")
                                  .replaceAll("LTD", "limited")
                                  .replaceAll(".", " ")
                                  .replaceAll("-$", " ")
                                  .replaceAll("{", "")
                                  .replaceAll("}", "")
                                  .replaceAll("(", "")
                                  .replaceAll(")", "")
                                  .replaceAll("&", "and")
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Z
                            </a>
                          </td>
                          <td className="border border-black p-2 underline text-blue-500 text-center">
                            <a
                              href={
                                "https://www.google.com/search?q=moneycontrol+" +
                                item.LONG_NAME.split(" - ")[0]
                                  .replaceAll("Ltd", "limited")
                                  .replaceAll("LTD", "limited")
                                  .replaceAll(".", " ")
                                  .replaceAll("-$", " ")
                                  .replaceAll("{", "")
                                  .replaceAll("}", "")
                                  .replaceAll("(", "")
                                  .replaceAll(")", "")
                                  .replaceAll("&", "and")
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              M.C
                            </a>
                          </td>
                          <td className="border border-black p-2 underline text-blue-500 text-center">
                            <a
                              href={
                                "https://miniphinzi.vercel.app/?name=" +
                                item.LONG_NAME.split(" - ")[0]
                                  .replaceAll("Ltd", "limited")
                                  .replaceAll("LTD", "limited")
                                  .replaceAll(".", " ")
                                  .replaceAll("-$", " ")
                                  .replaceAll("{", "")
                                  .replaceAll("}", "")
                                  .replaceAll("(", "")
                                  .replaceAll(")", "")
                                  .replaceAll("&", "and")
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              N
                            </a>
                          </td>
                          <td className="border border-black p-2 underline text-blue-500 text-center">
                            <a
                              href={
                                "https://chartink.com/stocks/" +
                                item.scrip_cd +
                                ".html"
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              C.I
                            </a>
                          </td>
                          <td className="border border-black p-2 underline text-blue-500 text-center">
                            <a
                              href={
                                "https://www.screener.in/company/" +
                                item.scrip_cd +
                                "/"
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              SC
                            </a>
                          </td>
                          <td className="border border-black p-2 text-center">{item.trd_vol}</td>
                          <td className="border border-black p-2 text-center">
                            {item.trendline_strength === 0 ? "🔴 " : "⭐"}
                          </td>
                          <td className="border border-black p-2 text-center">
                            {item.pivot_point_strength === 0 ? "🔴 " : "⭐"}
                          </td>
                          <td className="border border-black p-2 text-center">
                            {item.ema_strength === 0 ? "🔴 " : "⭐"}
                          </td>
                          <td className="border border-black p-2 text-center">
                            {item.rs_strength === null
                              ? "-"
                              : item.rs_strength === 0
                              ? "🔴 "
                              : "⭐"}
                          </td>
                        </tr>
                        <tr className="border-3 border-b-black">
                          <td className="border border-black"></td>
                          <td className="border border-black"></td>
                          <td
                            className="border border-black"
                            style={{
                              paddingTop: 10,
                              paddingBottom: 10,
                              paddingLeft: 25,
                              paddingRight: 25,
                              backgroundColor: "#F4F4F4",
                            }}
                          >
                            <table
                              className="text-[#13BD97] font-extrabold"
                              dangerouslySetInnerHTML={{
                                __html: innerHtmlg3,
                              }}
                            />
                          </td>
                          <td className="border border-black text-[#13BD97] font-extrabold px-[7px] text-center">
                            {item.comp_name?.g3tot || "N/A"}
                          </td>
                          <td className="border border-black text-[#13BD97] font-extrabold px-[7px] text-center">
                            {item.comp_name?.g3vtot || "N/A"}
                          </td>
                          <td className="border border-black text-[#13BD97] font-extrabold px-[7px] text-center">
                            {item.comp_name?.g3nettot || "N/A"}
                          </td>
                          {/* Empty cells for the second row */}
                          <td colSpan="15" className="border border-black"></td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
            </tbody>
          </table>
        </div>
      );
    };
    
    export default Home;
    `;

      const pagePath = `${volumetricPageDir}/page.tsx`;
      await fs.writeFile(pagePath, pageContent, "utf-8");
      console.log(`Page has been written to ${pagePath}`);

      // 5. Git operations (Optional - can be disabled via config)
      const shouldCommitToGit = process.env.AUTO_COMMIT !== "false";

      if (shouldCommitToGit) {
        const frontendDir = FRONTEND_ROOT;

        try {
          // Change to frontend directory
          process.chdir(frontendDir);

          // Git operations
          await execPromise("git add .");
          await execPromise(
            `git commit -m "Updated ${timeframeDisplayName} analysis for ${currentDate} - ${indicatorName}"`,
          );
          await execPromise("git push origin master");

          console.log("Successfully pushed changes to GitHub");
        } catch (gitError) {
          console.error("Error during git operations:", gitError.message);
          // Don't throw error for git operations, just log it
        }
      }
      // 6. Generate summary report
      const summary = {
        success: true,
        timestamp: new Date().toISOString(),
        indicatorName,
        timeframe: timeframeDisplayName,
        totalStocks,
        breakoutStocks: data.filter((stock) => stock.isBreakout === true)
          .length,
        dataPath: volumetricDataPath,
        pagePath: `${volumetricPageDir}/page.tsx`,
        generatedDate: currentDate,
      };

      console.log("=== SCRAPING SUMMARY ===");
      console.log(`✅ Success: ${summary.success}`);
      console.log(`📊 Indicator: ${summary.indicatorName}`);
      console.log(`⏰ Timeframe: ${summary.timeframe}`);
      console.log(`📈 Total Stocks: ${summary.totalStocks}`);
      console.log(`🚀 Breakout Stocks: ${summary.breakoutStocks}`);
      console.log(`📁 Data saved to: ${summary.dataPath}`);
      console.log(`🌐 Page created at: ${summary.pagePath}`);
      console.log("========================");

      return summary;
    }

    // 1. Write data to trend-level data file
    const trendLevelDataDir = getFrontendPath(
      "data",
      "trend-level",
      timeframeFolderName,
    );
    const trendLevelDataPath = path.join(
      trendLevelDataDir,
      `${currentDate}.ts`,
    );

    // Create directories if they don't exist
    if (!existsSync(trendLevelDataDir)) {
      await fs.mkdir(trendLevelDataDir, { recursive: true });
    }

    // Write data file with metadata
    const dataWithMetadata = {
      data: data,
      metadata: {
        indicatorName,
        timeframe,
        timeframeDisplayName,
        timestamp,
        totalStocks,
        generatedDate: currentDate,
        config: {
          baseUrl: config.baseUrl,
          timeframes: config.timeframes,
        },
      },
    };

    const tsCode = `// @ts-nocheck 
// Generated on: ${timestamp}
// Indicator: ${indicatorName}
// Timeframe: ${timeframeDisplayName}
// Total Stocks: ${totalStocks}

const stockData = ${JSON.stringify(data, null, 2)};

const metadata = ${JSON.stringify(dataWithMetadata.metadata, null, 2)};

export { stockData as data, metadata };
export default stockData;`;

    await fs.writeFile(trendLevelDataPath, tsCode, "utf-8");
    console.log(`Data has been written to ${trendLevelDataPath}`);

    // 2. Create trend-level page directory and file
    const trendLevelPageDir = getFrontendPath(
      "app",
      "trend-level",
      timeframeFolderName,
      currentDate,
    );
    if (!existsSync(trendLevelPageDir)) {
      await fs.mkdir(trendLevelPageDir, { recursive: true });
    }

    // 3. Update home page to add new button
    const homePagePath = getFrontendPath("app", "page.tsx");

    try {
      const homePageContent = await fs.readFile(homePagePath, "utf-8");

      // Parse the existing content to find the appropriate timeframe array
      const timeframeProperty = timeframeFolderName;
      const timeframeMatch = homePageContent.match(
        new RegExp(`${timeframeProperty}:\\s*\\[([\\s\\S]*?)\\]`),
      );

      if (timeframeMatch) {
        const existingButtons = timeframeMatch[1].trim();
        const newButton = `\n      { text: "${indicatorName}-${currentDate}", href: "/trend-level/${timeframeFolderName}/${currentDate}" },`;

        // Replace the old array with updated one
        const updatedContent = homePageContent.replace(
          new RegExp(`${timeframeProperty}:\\s*\\[([\\s\\S]*?)\\]`),
          `${timeframeProperty}: [${existingButtons}${newButton}\n    ]`,
        );

        await fs.writeFile(homePagePath, updatedContent, "utf-8");
        console.log(
          `Updated home page with new ${timeframeDisplayName} button`,
        );
      }
    } catch (homePageError) {
      console.warn("Could not update home page:", homePageError.message);
    }

    // 4. Create the trend-level page file
    const pageContent = `import { data, metadata } from "@/data/trend-level/${timeframeFolderName}/${currentDate}";
    import React from "react";
    
    export const revalidate = 0;
    
    const Home = async () => {
      return (
        <div>
          <div className="mb-4 p-4 bg-blue-50 rounded-lg">
            <h1 className="text-2xl font-bold text-blue-800">
              ${indicatorName} Analysis - ${timeframeDisplayName}
            </h1>
            <p className="text-sm text-gray-600">
              Generated on: {metadata.generatedDate} | Total Stocks:{" "}
              {metadata.totalStocks}
            </p>
          </div>
    
          <table className="mt-4 table w-full p-4">
            <thead
              className="rounded-md"
              style={{
                background:
                  "linear-gradient(270deg," + "#20bf55" + "," + "#01baef" + ")",
                position: "sticky",
                top: 0,
                color: "#fff",
                borderRadius: 10,
              }}
            >
              <tr>
                <th className="border border-black ">S.no</th>
                <th className="border border-black">Letters</th>
                <th className="border border-black ">Company Name</th>
                <th className="border border-black">T</th>
                <th className="border border-black">V</th>
                <th className="border border-black">C</th>
                <th className="border border-black text-2xl font-bold">
                  Br. Price
                </th>
                <th className="border border-black text-2xl font-bold">LTP</th>
                <th className="border border-black text-2xl font-bold">Now %</th>
                <th className="border border-black ">Tr.v</th>
                <th className="border border-black ">Z</th>
                <th className="border border-black ">M.C</th>
                <th className="border border-black ">N</th>
                <th className="border border-black ">C.I</th>
                <th className="border border-black ">SC</th>
                <th className="border border-black text-2xl font-bold">Volume</th>
                <th className="border border-black text-2xl font-bold">
                  TrendLine Strength
                </th>
                <th className="border border-black text-2xl font-bold">
                  Pivot Strength
                </th>
                <th className="border border-black text-2xl font-bold">
                  EMA Strength
                </th>
                <th className="border border-black text-2xl font-bold">
                  RS Strength
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Check if data exists before mapping */}
              {Array.isArray(data) &&
                data
                  // Filter for valid breakouts
                  .filter((stock: any) => {
                    const isBreakoutValid = stock.isBreakout === true;
                    const breakoutValue = Number(stock.value); // Use 'value' instead of 'breakoutValue'
                    const ltpValue = Number(stock.ltradert);
                    const isInvalidBreakoutLtpCombo =
                      breakoutValue < 10 && ltpValue >= 100;
                    return isBreakoutValid && !isInvalidBreakoutLtpCombo;
                  })
                  // Map through the filtered data to create table rows
                  .map((item: any, index: any) => {
                    // Use 'comp_name' instead of 'num_data'
                    const innerHtml =
                      typeof item?.comp_name === "object"
                        ? item?.comp_name.name_g2_block
                        : "<p></p>";
                    const innerHtmlg3 =
                      typeof item?.comp_name === "object"
                        ? item?.comp_name.name_g3_block
                        : "<p></p>";
    
                    return (
                      // Use React.Fragment to group the two rows for each stock
                      <React.Fragment key={index}>
                        <tr className="border border-black ">
                          <td className="border border-black text-center"> {index + 1}</td>
                          <td className="border border-black text-center">
                            {item.comp_name?.tot_letters || "N/A"}
                          </td>
                          <td
                            className="border border-black"
                            style={{
                              paddingTop: 10,
                              paddingBottom: 10,
                              paddingLeft: 25,
                              paddingRight: 25,
                              backgroundColor: "#F4F4F4",
                            }}
                          >
                            <table
                              className="text-[#13BD97] font-extrabold"
                              dangerouslySetInnerHTML={{ __html: innerHtml }}
                            ></table>
                          </td>
                          <td className="border border-black text-[#13BD97] font-extrabold px-[7px] text-center">
                            {item.comp_name?.g2tot || "N/A"}
                          </td>
                          <td className="border border-black text-[#13BD97] font-extrabold px-[7px] text-center">
                            {item.comp_name?.g2vtot || "N/A"}
                          </td>
                          <td className="border border-black text-[#13BD97] font-extrabold px-[7px] text-center">
                            {item.comp_name?.g2nettot || "N/A"}
                          </td>
                          <td className="border border-black p-2 text-xl text-center">
                            {item.value}
                          </td>
                          <td className="border border-black text-center">
                            <span className="font-extrabold text-xl text-green-700">
                              {item.ltradert}
                            </span>
                          </td>
                          <td className="border border-black p-2 text-xl text-center">
                            {item.change_percent + " %"}
                          </td>
                          <td className="border border-black text-center">
                            <a
                              href={
                                "https://in.tradingview.com/chart/qmDo3C1P/?symbol=BSE%3A" +
                                item.scripname
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 underline"
                            >
                              qmDo3C1P
                            </a>
                          </td>
                          <td className="border border-black p-2 underline text-blue-500 text-center">
                            <a
                              href={
                                "https://www.google.com/search?q=zauba+" +
                                item.LONG_NAME.split(" - ")[0]
                                  .replaceAll("Ltd", "limited")
                                  .replaceAll("LTD", "limited")
                                  .replaceAll(".", " ")
                                  .replaceAll("-$", " ")
                                  .replaceAll("{", "")
                                  .replaceAll("}", "")
                                  .replaceAll("(", "")
                                  .replaceAll(")", "")
                                  .replaceAll("&", "and")
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Z
                            </a>
                          </td>
                          <td className="border border-black p-2 underline text-blue-500 text-center">
                            <a
                              href={
                                "https://www.google.com/search?q=moneycontrol+" +
                                item.LONG_NAME.split(" - ")[0]
                                  .replaceAll("Ltd", "limited")
                                  .replaceAll("LTD", "limited")
                                  .replaceAll(".", " ")
                                  .replaceAll("-$", " ")
                                  .replaceAll("{", "")
                                  .replaceAll("}", "")
                                  .replaceAll("(", "")
                                  .replaceAll(")", "")
                                  .replaceAll("&", "and")
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              M.C
                            </a>
                          </td>
                          <td className="border border-black p-2 underline text-blue-500 text-center">
                            <a
                              href={
                                "https://miniphinzi.vercel.app/?name=" +
                                item.LONG_NAME.split(" - ")[0]
                                  .replaceAll("Ltd", "limited")
                                  .replaceAll("LTD", "limited")
                                  .replaceAll(".", " ")
                                  .replaceAll("-$", " ")
                                  .replaceAll("{", "")
                                  .replaceAll("}", "")
                                  .replaceAll("(", "")
                                  .replaceAll(")", "")
                                  .replaceAll("&", "and")
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              N
                            </a>
                          </td>
                          <td className="border border-black p-2 underline text-blue-500 text-center">
                            <a
                              href={
                                "https://chartink.com/stocks/" +
                                item.scrip_cd +
                                ".html"
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              C.I
                            </a>
                          </td>
                          <td className="border border-black p-2 underline text-blue-500 text-center">
                            <a
                              href={
                                "https://www.screener.in/company/" +
                                item.scrip_cd +
                                "/"
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              SC
                            </a>
                          </td>
                          <td className="border border-black p-2 text-center">{item.trd_vol}</td>
                          <td className="border border-black p-2 text-center">
                            {item.trendline_strength === 0 ? "🔴 " : "⭐"}
                          </td>
                          <td className="border border-black p-2 text-center">
                            {item.pivot_point_strength === 0 ? "🔴 " : "⭐"}
                          </td>
                          <td className="border border-black p-2 text-center">
                            {item.ema_strength === 0 ? "🔴 " : "⭐"}
                          </td>
                          <td className="border border-black p-2 text-center">
                            {item.rs_strength === null
                              ? "-"
                              : item.rs_strength === 0
                              ? "🔴 "
                              : "⭐"}
                          </td>
                        </tr>
                        <tr className="border-3 border-b-black">
                          <td className="border border-black"></td>
                          <td className="border border-black"></td>
                          <td
                            className="border border-black"
                            style={{
                              paddingTop: 10,
                              paddingBottom: 10,
                              paddingLeft: 25,
                              paddingRight: 25,
                              backgroundColor: "#F4F4F4",
                            }}
                          >
                            <table
                              className="text-[#13BD97] font-extrabold"
                              dangerouslySetInnerHTML={{
                                __html: innerHtmlg3,
                              }}
                            />
                          </td>
                          <td className="border border-black text-[#13BD97] font-extrabold px-[7px] text-center">
                            {item.comp_name?.g3tot || "N/A"}
                          </td>
                          <td className="border border-black text-[#13BD97] font-extrabold px-[7px] text-center">
                            {item.comp_name?.g3vtot || "N/A"}
                          </td>
                          <td className="border border-black text-[#13BD97] font-extrabold px-[7px] text-center">
                            {item.comp_name?.g3nettot || "N/A"}
                          </td>
                          {/* Empty cells for the second row */}
                          <td colSpan="15" className="border border-black"></td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
            </tbody>
          </table>
        </div>
      );
    };
    
    export default Home;
    `;

    const pagePath = `${trendLevelPageDir}/page.tsx`;
    await fs.writeFile(pagePath, pageContent, "utf-8");
    console.log(`Page has been written to ${pagePath}`);

    // 5. Git operations (Optional - can be disabled via config)
    const shouldCommitToGit = process.env.AUTO_COMMIT !== "false";

    if (shouldCommitToGit) {
      const frontendDir = FRONTEND_ROOT;

      try {
        // Change to frontend directory
        process.chdir(frontendDir);

        // Git operations
        await execPromise("git add .");
        await execPromise(
          `git commit -m "Updated ${timeframeDisplayName} analysis for ${currentDate} - ${indicatorName}"`,
        );
        await execPromise("git push origin master");

        console.log("Successfully pushed changes to GitHub");
      } catch (gitError) {
        console.error("Error during git operations:", gitError.message);
        // Don't throw error for git operations, just log it
      }
    }

    // 6. Generate summary report
    const summary = {
      success: true,
      timestamp: new Date().toISOString(),
      indicatorName,
      timeframe: timeframeDisplayName,
      totalStocks,
      breakoutStocks: data.filter((stock) => stock.isBreakout === true).length,
      dataPath: trendLevelDataPath,
      pagePath: `${trendLevelPageDir}/page.tsx`,
      generatedDate: currentDate,
    };

    console.log("=== SCRAPING SUMMARY ===");
    console.log(`✅ Success: ${summary.success}`);
    console.log(`📊 Indicator: ${summary.indicatorName}`);
    console.log(`⏰ Timeframe: ${summary.timeframe}`);
    console.log(`📈 Total Stocks: ${summary.totalStocks}`);
    console.log(`🚀 Breakout Stocks: ${summary.breakoutStocks}`);
    console.log(`📁 Data saved to: ${summary.dataPath}`);
    console.log(`🌐 Page created at: ${summary.pagePath}`);
    console.log("========================");

    return summary;
  } catch (error) {
    console.error("Error in handleFileWriting:", error);
    throw error;
  }
};

module.exports = handleFileWriting;
