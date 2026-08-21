import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage();

  await page.goto('http://localhost:8000/', { waitUntil: 'networkidle' });

  const getState = async () => {
    return await page.evaluate(() => ({
      station: Sim.state.station,
      packageState: Sim.state.packageState,
      packageT: Sim.state.packageT,
      dwellLeft: Sim.state.dwellLeft,
      running: Sim.state.running
    }));
  };

  console.log('=== Package State Verification ===\n');

  // Start simulation
  await page.click('#btn-run');
  await page.waitForTimeout(300);

  const captured = [];
  let lastStation = null;
  let iterations = 0;
  const maxIterations = 1000;  // 5 minutes at 300ms per iteration

  while (captured.length < 4 && iterations < maxIterations) {
    const state = await getState();

    if (state.station && state.station !== lastStation) {
      captured.push({
        station: state.station,
        packageState: state.packageState,
        packageT: state.packageT.toFixed(3)
      });
      console.log(`[${captured.length}] Reached: ${state.station}`);
      console.log(`    packageState: ${state.packageState}`);
      console.log(`    packageT: ${state.packageT.toFixed(3)}`);
      lastStation = state.station;
    }

    await page.waitForTimeout(300);
    iterations++;
  }

  console.log('\n=== RESULTS ===');
  console.log('Station transformations captured:\n');

  const expected = [
    { station: 'gateway', state: 'INGESTED' },
    { station: 'qualifier', state: 'QUALIFIED' },
    { station: 'filter', state: 'EVALUATED' },
    { station: 'evaluator', state: 'SURVEILLED' }
  ];

  for (let i = 0; i < Math.max(captured.length, expected.length); i++) {
    const c = captured[i];
    const e = expected[i];
    const match = c && e && c.station === e.station && c.packageState === e.state;
    const symbol = match ? '✓' : '✗';

    console.log(`${symbol} [${i + 1}] ${e ? e.station : 'N/A'}`);
    if (c) {
      console.log(`      got: ${c.packageState} (expected: ${e ? e.state : 'N/A'})`);
    } else {
      console.log(`      NOT CAPTURED (expected: ${e.state})`);
    }
    console.log('');
  }

  if (iterations >= maxIterations) {
    console.log(`\nWARNING: Hit iteration limit (${maxIterations})`);
    console.log('Simulation may be running slowly or stuck.');
  }

  await browser.close();
})().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
