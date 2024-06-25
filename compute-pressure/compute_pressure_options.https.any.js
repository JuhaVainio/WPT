// META: script=/resources/testdriver.js
// META: script=/resources/testdriver-vendor.js
// META: global=window

'use strict';

promise_test(async t => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  await test_driver.create_virtual_pressure_source('cpu');

  await new Promise(resolve => {
    const observer = new PressureObserver(resolve);
    t.add_cleanup(() => observer.disconnect());
    observer.observe('cpu', {sampleInterval: 0});
    test_driver.update_virtual_pressure_source('cpu', 'critical');
  });
}, 'PressureObserver observe method doesnt throw error for sampleInterval value 0');

promise_test(async t => {
  const observer =
      new PressureObserver(t.unreached_func('oops should not end up here'));
  t.add_cleanup(() => observer.disconnect());
  await promise_rejects_js(
      t, TypeError, observer.observe('cpu', {sampleInterval: -2}));
}, 'PressureObserver observe method requires a positive sampleInterval');

promise_test(async t => {
  const observer =
      new PressureObserver(t.unreached_func('oops should not end up here'));
  t.add_cleanup(() => observer.disconnect());
  await promise_rejects_js(
      t, TypeError, observer.observe('cpu', {sampleInterval: 2 ** 32}));
}, 'PressureObserver observe method requires a sampleInterval in unsigned long range');
