// META: script=/resources/testdriver.js
// META: script=/resources/testdriver-vendor.js
// META: global=window

'use strict';

promise_test(async t => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  await test_driver.create_virtual_pressure_source('cpu');

  // TODO(CP): Originally used performance.timeOrigin gives value e.g. 1716550400899
  //       which is in totally different ballpark as change[0].time which gives
  //       times like "150".
  const timeOrigin = performance.now();
  const change = await new Promise(resolve => {
    const observer = new PressureObserver(change => {
      resolve(change);
    });
    t.add_cleanup(() => observer.disconnect());
    observer.observe('cpu');
    test_driver.update_virtual_pressure_source('cpu', 'critical');
  });

  assert_greater_than(change[0].time, timeOrigin);
}, 'Timestamp from update should be greater than timeOrigin');

promise_test(async t => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  await test_driver.create_virtual_pressure_source('cpu');

  const readings = ['nominal', 'fair', 'serious', 'critical'];

  const sampleInterval = 250;
  const pressureChanges = [];
  const observer = new PressureObserver(changes => {
    pressureChanges.push(changes);
  });
  //TODO(CP): Is it OK to remove sampleInterval from observer. Maybe return it when
  //      there is sampleInterval parameter in virtual pressure source.
  observer.observe('cpu');

  let i = 0;
  // mockPressureService.updatesDelivered() does not necessarily match
  // pressureChanges.length, as system load and browser optimizations can
  // cause the actual timer used by mockPressureService to deliver readings
  // to be a bit slower or faster than requested.
  while (pressureChanges.length < 4) {
    await test_driver.update_virtual_pressure_source(
        'cpu', readings[i++ % readings.length]);
    await t.step_wait(
        () => pressureChanges.length >= i,
        `At least ${i} readings have been delivered`);
  }
  observer.disconnect();

  assert_equals(pressureChanges.length, 4);
  assert_greater_than(pressureChanges[1][0].time, pressureChanges[0][0].time);
  assert_greater_than(pressureChanges[2][0].time, pressureChanges[1][0].time);
  assert_greater_than(pressureChanges[3][0].time, pressureChanges[2][0].time);
}, 'Timestamp difference between two changes should be continuously increasing');

promise_test(async t => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  await test_driver.create_virtual_pressure_source('cpu');

  const readings = ['nominal', 'fair', 'serious', 'critical'];

  //TODO(CP): sampleInterval changed to some small number. Maybe return it to
  //      original "250" when there is sampleInterval parameter in virtual
  //      pressure source.
  const sampleInterval = 10;
  const pressureChanges = [];
  const observer = new PressureObserver(change => {
    pressureChanges.push(change);
  });
  observer.observe('cpu');

  let i = 0;
  // mockPressureService.updatesDelivered() does not necessarily match
  // pressureChanges.length, as system load and browser optimizations can
  // cause the actual timer used by mockPressureService to deliver readings
  // to be a bit slower or faster than requested.
  while (pressureChanges.length < 4) {
    await test_driver.update_virtual_pressure_source(
        'cpu', readings[i++ % readings.length]);
    await t.step_wait(
        () => pressureChanges.length >= i,
        `At least ${i} readings have been delivered`);
  }
  observer.disconnect();

  assert_equals(pressureChanges.length, 4);
  assert_greater_than_equal(
      pressureChanges[1][0].time - pressureChanges[0][0].time, sampleInterval);
  assert_greater_than_equal(
      pressureChanges[2][0].time - pressureChanges[1][0].time, sampleInterval);
  assert_greater_than_equal(
      pressureChanges[3][0].time - pressureChanges[2][0].time, sampleInterval);
}, 'Faster collector: Timestamp difference between two changes should be higher or equal to the observer sample rate');

promise_test(async t => {
  t.add_cleanup(async () => {
    await test_driver.remove_virtual_pressure_source('cpu');
  });

  await test_driver.create_virtual_pressure_source('cpu');

  const pressureChanges = [];
  const sampleInterval = 1000;
  const observer = new PressureObserver(changes => {
    pressureChanges.push(changes);
  });

  await new Promise(async resolve => {
    //observer.observe('cpu', {sampleInterval});
    observer.observe('cpu');
    await test_driver.update_virtual_pressure_source('cpu', 'critical');
    await t.step_wait(() => pressureChanges.length == 1);
    // TODO(CP): If disconnect line is enabled second promise gets stuck on
    //       step_wait line.
    //observer.disconnect();
    resolve();
  });

  await new Promise(async resolve => {
    observer.observe('cpu');
    await test_driver.update_virtual_pressure_source('cpu', 'serious');
    await t.step_wait(() => pressureChanges.length == 2);
    observer.disconnect();
    resolve();
  });

  assert_equals(pressureChanges.length, 2);
  // When disconnect() is called, PressureRecord in [[LastRecordMap]] for cpu
  // should be deleted. So the second PressureRecord is not discarded even
  // though the time interval does not meet the requirement.
  assert_less_than(
      (pressureChanges[1][0].time - pressureChanges[0][0].time),
      sampleInterval);
}, 'disconnect() should update [[LastRecordMap]]');
