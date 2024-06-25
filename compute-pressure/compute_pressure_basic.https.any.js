// META: script=/resources/testdriver.js
// META: script=/resources/testdriver-vendor.js
// META: global=window

'use strict';

promise_test(async (t) => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  const observer = new PressureObserver(() => {
    assert_unreached('The observer callback should not be called');
  });
  await test_driver.create_virtual_pressure_source('cpu', {supported: false});
  return promise_rejects_dom(t, 'NotSupportedError', observer.observe('cpu'));
}, 'Return NotSupportedError when calling observer()');

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
  assert_equals(changes[0].state, 'critical');
  assert_equals(changes[0].source, 'cpu');
  assert_equals(typeof changes[0].time, 'number');
}, 'Basic functionality test');

promise_test(async (t) => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  await test_driver.create_virtual_pressure_source('cpu');

  const observer = new PressureObserver(() => {
    assert_unreached('The observer callback should not be called');
  });

  //TODO(CP) In this test if observer.observe is before update_virtual_pressure_source
  //         test fails. Order of these two commands?
  //         [FAIL] Removing observer before observe() resolves works
  //         assert_unreached: Should have rejected: undefined Reached unreachable code
  await test_driver.update_virtual_pressure_source('cpu', 'critical');
  const promise = observer.observe('cpu');
  observer.unobserve('cpu');

  return promise_rejects_dom(t, 'AbortError', promise);
}, 'Removing observer before observe() resolves works');

promise_test(async (t) => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  const callbackPromises = [];
  const observePromises = [];

  await test_driver.create_virtual_pressure_source('cpu');

  for (let i = 0; i < 2; i++) {
    callbackPromises.push(new Promise(resolve => {
      const observer = new PressureObserver(resolve);
      t.add_cleanup(() => observer.disconnect());
      observePromises.push(observer.observe('cpu'));
    }));
  }

  await Promise.all(observePromises);
  await test_driver.update_virtual_pressure_source('cpu', 'critical');
  return Promise.all(callbackPromises);
}, 'Calling observe() multiple times works');

promise_test(async (t) => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  await test_driver.create_virtual_pressure_source('cpu');

  const observer1_changes = [];
  await new Promise(resolve => {
    const observer1 = new PressureObserver(changes => {
      observer1_changes.push(changes);
      resolve();
    });
    t.add_cleanup(() => observer1.disconnect());
    observer1.observe('cpu');
    test_driver.update_virtual_pressure_source('cpu', 'critical');
  });
  assert_true(observer1_changes.length === 1);
  assert_equals(observer1_changes[0][0].source, 'cpu');
  assert_equals(observer1_changes[0][0].state, 'critical');

  const observer2_changes = [];
  await new Promise(resolve => {
    const observer2 = new PressureObserver(changes => {
      observer2_changes.push(changes);
      resolve();
    });
    t.add_cleanup(() => observer2.disconnect());
    observer2.observe('cpu');
    // TODO(CP): Without sampleInterval in virtual pressure source new update is
    //       needed.
    test_driver.update_virtual_pressure_source('cpu', 'critical');
  });
  assert_true(observer2_changes.length === 1);
  assert_equals(observer2_changes[0][0].source, 'cpu');
  assert_equals(observer2_changes[0][0].state, 'critical');
}, 'Starting a new observer after an observer has started works');
