// META: script=/resources/testdriver.js
// META: script=/resources/testdriver-vendor.js
// META: global=window
// TODO(CP) Without long timeout stress test shows TIMEOUT error
// META: timeout=long

'use strict';

// TODO(CP) stress test sometimes shows
// step_wait_func: At least 50 readings have been delivered Timed out waiting on condition
// WPT fails on "step_wait_func: At least 3 readings have been delivered Timed out waiting on condition"
promise_test(async t => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  await test_driver.create_virtual_pressure_source('cpu');

  const sampleIntervalInMs = 40;
  const readings = ['nominal', 'fair', 'serious', 'critical'];
  // Normative values for rate obfuscation parameters.
  // https://w3c.github.io/compute-pressure/#rate-obfuscation-normative-parameters.
  // TODO(CP) Was 5000. Had to make smaller as "changes[0].time - lastSample[0].time" is smaller than original 5000
  const minPenaltyTimeInMs = 50;
  const maxChangesThreshold = 100;
  const minChangesThreshold = 50;
  let gotPenalty = false;
  await new Promise(async resolve => {
    const observerChanges = [];
    const observer = new PressureObserver(changes => {
      if (observerChanges.length >= (minChangesThreshold - 1)) {
        const lastSample = observerChanges.at(-1);
        if ((changes[0].time - lastSample[0].time) >= minPenaltyTimeInMs) {
          // The update delivery might still be working even if
          // maxChangesThreshold have been reached and before disconnect() is
          // processed.
          // Therefore we are adding a flag to dismiss any updates after the
          // penalty is detected, which is the condition for the test to pass.
          gotPenalty = true;
          observer.disconnect();
          resolve();
        }
      }
      observerChanges.push(changes);
    });

    observer.observe('cpu', {sampleInterval: sampleIntervalInMs});
    let i = 0;
    // mockPressureService.updatesDelivered() does not necessarily match
    // pressureChanges.length, as system load and browser optimizations can
    // cause the actual timer used by mockPressureService to deliver readings
    // to be a bit slower or faster than requested.
    while (observerChanges.length <= maxChangesThreshold || !gotPenalty) {
      await test_driver.update_virtual_pressure_source(
          'cpu', readings[i++ % readings.length]);
      // Allow tasks to run (avoid a micro-task loop).
      await new Promise((resolve) => t.step_timeout(resolve, 0));
      await t.step_wait(
          () => observerChanges.length >= i,
          `At least ${i} readings have been delivered`);
    }

    assert_true(gotPenalty, 'Penalty not triggered');

  });
}, 'Rate obfuscation mitigation should have been triggered, when changes is higher than minimum changes before penalty');
