#!/usr/bin/env bash
set -euo pipefail
node <<'JS'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({args: ['--no-sandbox']});
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(process.env.APP_URL.replace(/\/$/, '') + '/book?id=1');
    await page.locator('#seats').fill('3');
    const total = await page.locator('#total').textContent();
    if (total !== '36') throw new Error('Expected $36, got $' + total);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
JS
