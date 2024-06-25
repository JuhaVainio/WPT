// META: script=/resources/testdriver.js
// META: script=/resources/testdriver-vendor.js
// META: global=window

'use strict';

promise_test(async (t) => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  await test_driver.create_virtual_pressure_source('cpu');

  const changes = await new Promise(resolve => {
    const observer = new PressureObserver(resolve);
    t.add_cleanup(() => observer.disconnect());
    observer.observe('cpu');
    test_driver.update_virtual_pressure_source('cpu', 'critical');
    });
  assert_true(changes.length === 1);
  const json = changes[0].toJSON();
  assert_equals(json.state, 'critical');
  assert_equals(json.source, 'cpu');
  assert_equals(typeof json.time, 'number');
}, 'Basic functionality test');
