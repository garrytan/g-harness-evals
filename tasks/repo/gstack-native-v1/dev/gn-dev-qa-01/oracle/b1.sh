#!/usr/bin/env bash
set -euo pipefail
node <<'JS'
const { chromium } = require('playwright');
(async () => {
  let browser;
  try {
    browser = await chromium.launch({args: ['--no-sandbox']});
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(process.env.APP_URL.replace(/\/$/, '') + '/new', {timeout: 10000});
    await page.locator('[name=capacity]').fill('4');
    await page.locator('[name=hours]').fill('3');
    const total = await page.locator('#total').textContent();
    if (total.trim() !== '12') throw new Error('Expected 12 person-hours, got ' + total);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
JS
