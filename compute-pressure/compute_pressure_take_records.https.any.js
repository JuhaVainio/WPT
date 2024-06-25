// META: script=/resources/testdriver.js
// META: script=/resources/testdriver-vendor.js
// META: global=window

'use strict';

test(t => {
  const observer = new PressureObserver(
      t.unreached_func('This callback should not have been called.'));

  const records = observer.takeRecords();
  assert_equals(records.length, 0, 'No record before observe');
}, 'Calling takeRecords() before observe()');

promise_test(async (t) => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  await test_driver.create_virtual_pressure_source('cpu');

  let observer;
  const changes = await new Promise(resolve => {
    observer = new PressureObserver(resolve);
    t.add_cleanup(() => observer.disconnect());

    observer.observe('cpu');
    test_driver.update_virtual_pressure_source('cpu', 'critical');
  });
  assert_equals(changes[0].state, 'critical');

  const records = observer.takeRecords();
  assert_equals(records.length, 0, 'No record available');
}, 'takeRecords() returns empty record after callback invoke');
