// META: script=/resources/testdriver.js
// META: script=/resources/testdriver-vendor.js
// META: global=window

'use strict';

promise_test(async (t) => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  await test_driver.create_virtual_pressure_source('cpu');

  const pressureChanges = await new Promise(async resolve => {
    const observer_changes = [];
    let n = 0;
    const observer = new PressureObserver(changes => {
      observer_changes.push(changes);
      if (++n === 2)
        resolve(observer_changes);
    });
    // TODO(CP): Old line is maybe possible when sampleInterval is available.
    //observer.observe('cpu', {sampleInterval: 200});
    observer.observe('cpu');
    await test_driver.update_virtual_pressure_source('cpu', 'critical');
    await t.step_wait(() => observer_changes.length == 1);
    // Deliver 2 updates.
    await test_driver.update_virtual_pressure_source('cpu', 'nominal');
    // Deliver more updates, |resolve()| will be called when the new pressure
    // state reaches PressureObserver and its callback is invoked
    // for the second time.
  });

  assert_equals(pressureChanges.length, 2);
  assert_equals(pressureChanges[0][0].state, 'critical');
  assert_equals(pressureChanges[1][0].state, 'nominal');
}, 'Changes that fail the "has change in data" test are discarded.');
