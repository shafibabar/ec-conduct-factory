import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  await page.goto('http://localhost:8000/', { waitUntil: 'networkidle' });

  // Start simulation
  await page.click('#btn-run');
  await page.waitForTimeout(300);

  const getState = async () => {
    return await page.evaluate(() => ({
      station: Sim.state.station,
      packageState: Sim.state.packageState
    }));
  };

  // Wait for each station and capture zoomed view
  const stations = ['gateway', 'qualifier', 'filter', 'evaluator'];
  let captured = 0;

  for (const targetStation of stations) {
    let found = false;
    for (let i = 0; i < 500; i++) {
      const state = await getState();
      if (state.station === targetStation) {
        found = true;
        console.log(`Found ${targetStation} at packageState: ${state.packageState}`);
        break;
      }
      await page.waitForTimeout(100);
    }

    if (found) {
      // Click zoom in a few times to get closer view
      for (let z = 0; z < 3; z++) {
        await page.click('#zoom-in');
        await page.waitForTimeout(200);
      }

      // Take screenshot
      const filename = `package-zoom-${targetStation}.png`;
      await page.screenshot({ path: filename });
      console.log(`  → Saved: ${filename}`);
      captured++;

      // Click zoom out to return to normal
      for (let z = 0; z < 3; z++) {
        await page.click('#zoom-out');
        await page.waitForTimeout(200);
      }
    } else {
      console.log(`✗ ${targetStation}: not reached in time`);
    }
  }

  console.log(`\nCaptured ${captured} of ${stations.length} stations`);
  await browser.close();
})().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
