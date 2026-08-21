import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  await page.goto('http://localhost:8000/', { waitUntil: 'networkidle' });

  const getState = async () => {
    return await page.evaluate(() => ({
      station: Sim.state.station,
      packageState: Sim.state.packageState,
      terminalFork: Sim.state.terminalFork,
      pipelineIds: Sim.state.pipelineIds,
      sampled: Sim.state.sampled,
      evaluatorStalled: Sim.state.evaluatorStalled
    }));
  };

  console.log('=== Terminal Fork Visualization Test ===\n');

  // Test 1: B1 at qualifier (pipelineIds = 0)
  console.log('Test 1: B1 at qualifier (People = 0)');
  await page.evaluate(() => {
    Sim.state.participants = 0;  // No participants → no pipelines
  });
  await page.click('#btn-run');
  await page.waitForTimeout(300);

  for (let i = 0; i < 600; i++) {
    const state = await getState();
    if (state.packageState === 'TERMINATED' && state.terminalFork === 'B1') {
      console.log(`  ✓ Reached B1: terminalFork=${state.terminalFork}, station=${state.station}`);
      await page.click('#zoom-in');
      await page.click('#zoom-in');
      await page.click('#zoom-in');
      await page.waitForTimeout(300);
      await page.screenshot({ path: 'fork-b1.png' });
      console.log('  ✓ Screenshot: fork-b1.png\n');
      break;
    }
    if (i % 100 === 0) process.stdout.write('.');
    await page.waitForTimeout(50);
  }

  // Reset and test 2: C at evaluator (Content% = 100, Cognition past ceiling)
  console.log('Test 2: C at evaluator (Content% = 100, high Cognition)');
  await page.click('#btn-run');  // Pause
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    Sim.reset();
    Sim.state.participants = 100;  // Back to normal
    Sim.state.contentPolicyShare = 100;  // All need content evaluation
    Sim.state.cognitionRttMs = 10000000;  // Way past the 9M ceiling
  });
  await page.click('#btn-run');  // Resume
  await page.waitForTimeout(300);

  for (let i = 0; i < 600; i++) {
    const state = await getState();
    if (state.packageState === 'TERMINATED' && state.terminalFork === 'C') {
      console.log(`  ✓ Reached C: terminalFork=${state.terminalFork}, station=${state.station}`);
      for (let z = 0; z < 3; z++) {
        await page.click('#zoom-in');
        await page.waitForTimeout(100);
      }
      await page.screenshot({ path: 'fork-c.png' });
      console.log('  ✓ Screenshot: fork-c.png\n');
      break;
    }
    if (i % 100 === 0) process.stdout.write('.');
    await page.waitForTimeout(50);
  }

  // Reset and test 3: B3 at quota (Sampling = 0)
  console.log('Test 3: B3 at quota (Sampling% = 0)');
  await page.click('#btn-run');  // Pause
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    Sim.reset();
    Sim.state.contentPolicyShare = 40;  // Back to normal
    Sim.state.cognitionRttMs = 45000;  // Back to normal
    Sim.state.samplingPercent = 0;  // Nothing gets sampled
  });
  await page.click('#btn-run');  // Resume
  await page.waitForTimeout(300);

  for (let i = 0; i < 600; i++) {
    const state = await getState();
    if (state.packageState === 'TERMINATED' && state.terminalFork === 'B3') {
      console.log(`  ✓ Reached B3: terminalFork=${state.terminalFork}, station=${state.station}`);
      for (let z = 0; z < 3; z++) {
        await page.click('#zoom-in');
        await page.waitForTimeout(100);
      }
      await page.screenshot({ path: 'fork-b3.png' });
      console.log('  ✓ Screenshot: fork-b3.png\n');
      break;
    }
    if (i % 100 === 0) process.stdout.write('.');
    await page.waitForTimeout(50);
  }

  console.log('\n=== DONE ===');
  await browser.close();
})().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
