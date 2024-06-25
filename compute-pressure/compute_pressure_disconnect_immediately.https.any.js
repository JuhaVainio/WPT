// META: script=/resources/testdriver.js
// META: script=/resources/testdriver-vendor.js
// META: global=window

'use strict';

promise_test(async t => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  await test_driver.create_virtual_pressure_source('cpu');

  const observer1_changes = [];
  const observer1 = new PressureObserver(changes => {
    observer1_changes.push(changes);
  });
  t.add_cleanup(() => observer1.disconnect());
  // Ensure that observer1's schema gets registered before observer2 starts.
  const promise = observer1.observe('cpu');
  observer1.disconnect();
  await promise_rejects_dom(t, 'AbortError', promise);

  const observer2_changes = [];
  await new Promise((resolve, reject) => {
    const observer2 = new PressureObserver(changes => {
      observer2_changes.push(changes);
      resolve();
    });
    t.add_cleanup(() => observer2.disconnect());
    observer2.observe('cpu').catch(reject);
    test_driver.update_virtual_pressure_source('cpu', 'critical');
  });

  assert_equals(
      observer1_changes.length, 0,
      'stopped observers should not receive callbacks');

  assert_equals(observer2_changes.length, 1);
  assert_equals(observer2_changes[0].length, 1);
  assert_equals(observer2_changes[0][0].state, 'critical');
}, 'Stopped PressureObserver do not receive changes');

promise_test(async t => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  await test_driver.create_virtual_pressure_source('cpu');

  const observer1_changes = [];
  const observer1 = new PressureObserver(changes => {
    observer1_changes.push(changes);
  });
  t.add_cleanup(() => observer1.disconnect());

  const observer2_changes = [];
  await new Promise(async resolve => {
    const observer2 = new PressureObserver(changes => {
      observer2_changes.push(changes);
      resolve();
    });
    t.add_cleanup(() => observer2.disconnect());
    const promise = observer1.observe('cpu');
    observer2.observe('cpu');
    observer1.disconnect();
    await promise_rejects_dom(t, 'AbortError', promise);
    test_driver.update_virtual_pressure_source('cpu', 'critical');
  });

  assert_equals(
      observer1_changes.length, 0,
      'stopped observers should not receive callbacks');

  assert_equals(observer2_changes.length, 1);
  assert_equals(observer2_changes[0][0].state, 'critical');
}, 'Removing observer before observe() resolves does not affect other observers');
