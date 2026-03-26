// scraper.js
const puppeteer = require("puppeteer");

// Aap chahein toh proxy array yahan daal sakte hain
async function scrapeInstaReel(url) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage" // EC2 RAM crash se bachane ke liye zaroori hai
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36");

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); // Fast loading
        
        // Aapka logic to find view count in scripts
        const data = await page.evaluate(() => {
            let views = null;
            const scripts = document.querySelectorAll("script");
            for (let script of scripts) {
                const content = script.innerHTML;
                if (content.includes("video_view_count")) {
                    const match = content.match(/"video_view_count":(\d+)/);
                    if (match) views = parseInt(match[1]);
                }
            }
            return views;
        });

        await browser.close();
        return data; // Returns exact views or null
    } catch (error) {
        console.error("Scraper Error:", error.message);
        if (browser) await browser.close();
        return null;
    }
}

module.exports = { scrapeInstaReel };