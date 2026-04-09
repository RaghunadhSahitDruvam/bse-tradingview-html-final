const fs = require("fs");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--start-maximized", // Start the window maximized
    ],
    defaultViewport: null, // Disable the default viewport setting
  });

  const page = await browser.newPage();

  // Set the viewport to full screen size
  const { width, height } = await page.evaluate(() => ({
    width: window.screen.width,
    height: window.screen.height,
  }));
  await page.setViewport({ width, height });

  // Set a global navigation timeout of 60 seconds
  await page.setDefaultNavigationTimeout(60000);

  // Go to TradingView login page
  await page.goto("https://www.tradingview.com/#signin", {
    waitUntil: "networkidle2",
    timeout: 0,
  });

  // Click the login button (adjust selector if necessary)
  await page.click(
    "body > div:nth-of-type(8) > div > div > div:first-of-type > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div > button"
  );

  // Fill in the login form
  await page.type("#id_username", "s3uqog1", { delay: 100 });
  await page.type("#id_password", "Pradyumna@9", { delay: 100 });
  await page.click(
    "body > div:nth-of-type(8) > div > div > div:first-of-type > div > div:nth-of-type(2) > div:nth-of-type(2) > div > div > div > form > button"
  );

  // Wait for user icon selector to appear after manual CAPTCHA solving
  await page.waitForSelector(
    "body > div:nth-of-type(3) > div:nth-of-type(3) > div:nth-of-type(2) > div:nth-of-type(3) > button:nth-of-type(3)",
    { timeout: 60000 }
  );

  // Check if login was successful
  const userIcon = await page.$(
    "body > div:nth-of-type(3) > div:nth-of-type(3) > div:nth-of-type(2) > div:nth-of-type(3) > button:nth-of-type(3)"
  );
  if (userIcon) {
    console.log("Login successful");
    const cookies = await page.cookies();
    fs.writeFileSync("./cookies.json", JSON.stringify(cookies));
    console.log("first");

    // Save cookies after logging in

    console.log("Session cookies saved.");
  } else {
    console.log("Login failed");
  }

  await browser.close();
})();
