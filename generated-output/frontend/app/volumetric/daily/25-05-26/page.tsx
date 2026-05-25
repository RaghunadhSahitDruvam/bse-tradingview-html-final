import { data, metadata } from "@/data/volumetric/daily/25-05-26";
    import React from "react";
    
    export const revalidate = 0;
    
    const Home = async () => {
      return (
        <div>
          <div className="mb-4 p-4 bg-blue-50 rounded-lg">
            <h1 className="text-2xl font-bold text-blue-800">
              Volumetric-Ulgo Analysis - Daily
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
    