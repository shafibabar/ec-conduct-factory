import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  await page.goto('http://localhost:8000/', { waitUntil: 'networkidle' });

  // Start and let sim run to gateway
  await page.click('#btn-run');
  await page.waitForTimeout(300);

  const getState = async () => {
    return await page.evaluate(() => ({
      station: Sim.state.station
    }));
  };

  // Wait for gateway
  for (let i = 0; i < 500; i++) {
    const state = await getState();
    if (state.station === 'gateway') {
      // Zoom in
      for (let z = 0; z < 3; z++) {
        await page.click('#zoom-in');
        await page.waitForTimeout(150);
      }
      await page.screenshot({ path: 'orientation-gateway.png' });
      console.log('✓ Captured gateway with corrected orientation');
      break;
    }
    await page.waitForTimeout(100);
  }

  await browser.close();
})().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
