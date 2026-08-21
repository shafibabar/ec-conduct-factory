import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto('http://localhost:8000/', { waitUntil: 'networkidle' });

  console.log('=== VISUAL CHECK: Package Transformation at 4 Stations ===\n');

  // Start simulation
  console.log('Starting simulation...');
  await page.click('#btn-run');
  await page.waitForTimeout(1000);

  // Take initial screenshot
  console.log('0. Taking RAW screenshot (before any station)...');
  await page.screenshot({ path: 'screenshot-0-raw.png' });

  // Wait for GATEWAY and dwell
  console.log('1. Waiting for GATEWAY (~3 seconds for dwell)...');
  await page.waitForTimeout(5000);
  console.log('   Taking GATEWAY screenshot...');
  await page.screenshot({ path: 'screenshot-1-gateway.png' });

  // Wait for QUALIFIER and dwell
  console.log('2. Waiting for QUALIFIER (~5 seconds for transit + dwell)...');
  await page.waitForTimeout(7000);
  console.log('   Taking QUALIFIER screenshot...');
  await page.screenshot({ path: 'screenshot-2-qualifier.png' });

  // Wait for FILTER and dwell
  console.log('3. Waiting for FILTER (~5 seconds for transit + dwell)...');
  await page.waitForTimeout(7000);
  console.log('   Taking FILTER screenshot...');
  await page.screenshot({ path: 'screenshot-3-filter.png' });

  // Wait for EVALUATOR and dwell
  console.log('4. Waiting for EVALUATOR (~5 seconds for transit + dwell)...');
  await page.waitForTimeout(7000);
  console.log('   Taking EVALUATOR screenshot...');
  await page.screenshot({ path: 'screenshot-4-evaluator.png' });

  await browser.close();
  console.log('\n=== Screenshots saved ===');
  console.log('  screenshot-0-raw.png');
  console.log('  screenshot-1-gateway.png');
  console.log('  screenshot-2-qualifier.png');
  console.log('  screenshot-3-filter.png');
  console.log('  screenshot-4-evaluator.png');
})().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
