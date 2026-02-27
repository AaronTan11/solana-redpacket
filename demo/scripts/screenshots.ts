import { chromium } from "playwright";
import path from "path";

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const BASE_URL = "https://solana-redpacket.vercel.app";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1720, height: 864 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });

  const page = await context.newPage();

  // Screenshot 1: Home page (create form - wallet not connected state)
  console.log("Taking screenshot: home page...");
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: path.join(PUBLIC_DIR, "ss-home.png"),
    type: "png",
  });
  console.log("  -> ss-home.png saved");

  // Screenshot 2: Try a claim page (even without a real packet, shows the layout)
  // Use a dummy address to get the page structure
  console.log("Taking screenshot: claim page...");
  await page.goto(
    `${BASE_URL}/claim/7xKdVnRBRVLpGe3VYzmppBfKRNRFnmjNHSudcbJAsGbp/1740000000000`,
    { waitUntil: "networkidle" }
  );
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: path.join(PUBLIC_DIR, "ss-claim.png"),
    type: "png",
  });
  console.log("  -> ss-claim.png saved");

  // Screenshot 3: Dashboard page
  console.log("Taking screenshot: dashboard...");
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: path.join(PUBLIC_DIR, "ss-dashboard.png"),
    type: "png",
  });
  console.log("  -> ss-dashboard.png saved");

  await browser.close();
  console.log("\nAll screenshots saved to demo/public/");
}

main().catch(console.error);
