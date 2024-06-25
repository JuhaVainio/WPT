// META: script=/resources/testdriver.js
// META: script=/resources/testdriver-vendor.js
// META: global=window

'use strict';

// TODO(CP): Fails in WPT, works in content_shell path
// "step_wait_func: At least 2 readings have been delivered Timed out waiting on condition"
promise_test(async t => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  await test_driver.create_virtual_pressure_source('cpu');

  const sampleIntervalInMs = 100;
  const readings = ['nominal', 'fair', 'serious', 'critical'];
  // Normative values for rate obfuscation parameters.
  // https://w3c.github.io/compute-pressure/#rate-obfuscation-normative-parameters.
  const minPenaltyTimeInMs = 5000;
  const minChangesThreshold = 50;

  const changes = await new Promise(async resolve => {
    const observerChanges = [];
    const observer = new PressureObserver(changes => {
      observerChanges.push(changes);
    });

    observer.observe('cpu', {sampleInterval: sampleIntervalInMs});
    let i = 0;
    // mockPressureService.updatesDelivered() does not necessarily match
    // pressureChanges.length, as system load and browser optimizations can
    // cause the actual timer used by mockPressureService to deliver readings
    // to be a bit slower or faster than requested.
    while (observerChanges.length < minChangesThreshold) {
      await test_driver.update_virtual_pressure_source(
          'cpu', readings[i++ % readings.length]);
      // Allow tasks to run (avoid a micro-task loop).
      await new Promise((resolve) => t.step_timeout(resolve, 0));
      await t.step_wait(
          () => observerChanges.length >= i,
          `At least ${i} readings have been delivered`);
    }
    observer.disconnect();
    resolve(observerChanges);
  });
  assert_equals(changes.length, minChangesThreshold);

  for (let i = 0; i < (changes.length - 1); i++) {
    // Because no penalty should be triggered, the timestamp difference
    // between samples should be less than the minimum penalty.
    assert_less_than(
        changes[i + 1][0].time - changes[i][0].time, minPenaltyTimeInMs,
        'Not in sample time boundaries');
  }
}, 'No rate obfuscation mitigation should happen, when number of changes is below minimum changes before penalty');
