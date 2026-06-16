import { chromium } from "playwright";

const target = process.argv[2];
if (!target) throw new Error("pass a path to sidepanel.html");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 384, height: 820 } });
await page.goto("file://" + target);
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/goldeye-lens.png" });
await browser.close();
console.log("screenshot written to /tmp/goldeye-lens.png");
