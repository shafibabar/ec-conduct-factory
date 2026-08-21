import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage();

  await page.goto('http://localhost:8000/', { waitUntil: 'networkidle' });

  const getFullState = async () => {
    return await page.evaluate(() => ({
      packageState: Sim.state.packageState,
      packageT: Sim.state.packageT,
      station: Sim.state.station,
      running: Sim.state.running,
      paused: Sim.state.paused,
      reading: Sim.state.reading,
      dwellLeft: Sim.state.dwellLeft,
      pipelineCount: Sim.state.pipelineCount
    }));
  };

  console.log('=== PACKAGE TRANSFORMATION CHECK ===\n');

  console.log('0. INITIAL STATE:');
  let state = await getFullState();
  console.log(`   packageState: ${state.packageState}`);
  console.log(`   station: ${state.station}`);
  console.log(`   running: ${state.running}\n`);

  // Start simulation
  console.log('Starting simulation...');
  await page.click('#btn-run');
  await page.waitForTimeout(500);

  // Optionally speed up: set a faster speed
  // await page.evaluate(() => { Sim.speed = 10; });

  state = await getFullState();
  console.log(`   After START: running=${state.running}, reading=${state.reading}\n`);

  // Watch for stations
  console.log('Watching for first 4 stations (120 iterations, 2sec each)...\n');
  const stations = [];

  for (let i = 0; i < 120; i++) {
    state = await getFullState();

    // Log when station changes
    if (!stations.length || state.station !== stations[stations.length - 1].station) {
      if (state.station) {
        stations.push({
          station: state.station,
          packageState: state.packageState,
          packageT: parseFloat(state.packageT.toFixed(2)),
          reading: state.reading,
          dwellLeft: parseFloat(state.dwellLeft.toFixed(2))
        });

        console.log(`[${stations.length}] STATION: ${state.station}`);
        console.log(`    packageState: ${state.packageState}`);
        console.log(`    packageT: ${state.packageT.toFixed(2)}`);
        console.log(`    reading: ${state.reading}`);
        console.log(`    dwellLeft: ${state.dwellLeft.toFixed(2)}\n`);

        if (stations.length >= 4) break;
      }
    }

    await page.waitForTimeout(200);
  }

  console.log('=== STATION SEQUENCE ===');
  stations.forEach((st, i) => {
    console.log(`${i + 1}. ${st.station}: packageState=${st.packageState}, packageT=${st.packageT}`);
  });

  if (stations.length < 4) {
    console.log(`\nWARNING: Only captured ${stations.length} stations (expected 4)`);
  }

  await browser.close();
  console.log('\n=== DONE ===');
})().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
