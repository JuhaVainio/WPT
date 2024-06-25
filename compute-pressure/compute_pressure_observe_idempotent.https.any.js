// META: script=/resources/testdriver.js
// META: script=/resources/testdriver-vendor.js
// META: global=window

'use strict';

promise_test(async t => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  await test_driver.create_virtual_pressure_source('cpu');

  const update = await new Promise((resolve, reject) => {
    const observer = new PressureObserver(resolve);
    t.add_cleanup(() => observer.disconnect());
    observer.observe('cpu').catch(reject);
    observer.observe('cpu').catch(reject);
    observer.observe('cpu').catch(reject);
    test_driver.update_virtual_pressure_source('cpu', 'critical');
  });

  assert_equals(update[0].state, 'critical');
}, 'PressureObserver.observe() is idempotent');
