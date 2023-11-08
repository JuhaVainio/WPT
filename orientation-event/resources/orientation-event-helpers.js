'use strict';

// These tests rely on the User Agent providing an implementation of
// platform sensor backends.
//
// In Chromium-based browsers this implementation is provided by a polyfill
// in order to reduce the amount of test-only code shipped to users. To enable
// these tests the browser must be run with these options:
//
//   --enable-blink-features=MojoJS,MojoJSTest
async function loadChromiumResources() {
  await import('/resources/chromium/generic_sensor_mocks.js');
}

async function initialize_generic_sensor_tests() {
  if (typeof GenericSensorTest === 'undefined') {
    const script = document.createElement('script');
    script.src = '/resources/test-only-api.js';
    script.async = false;
    const p = new Promise((resolve, reject) => {
      script.onload = () => { resolve(); };
      script.onerror = e => { reject(e); };
    })
    document.head.appendChild(script);
    await p;

    if (isChromiumBased) {
      await loadChromiumResources();
    }
  }
  assert_implements(GenericSensorTest, 'GenericSensorTest is unavailable.');
  let sensorTest = new GenericSensorTest();
  await sensorTest.initialize();
  return sensorTest;
}

function sensor_test(func, name, properties) {
  promise_test(async (t) => {
    t.add_cleanup(() => {
      if (sensorTest)
        return sensorTest.reset();
    });

    let sensorTest = await initialize_generic_sensor_tests();
    return func(t, sensorTest.getSensorProvider());
  }, name, properties);
}

async function set_permissions() {
  await test_driver.set_permission({name: 'accelerometer'}, 'granted');
  await test_driver.set_permission({name: 'gyroscope'}, 'granted');
  assert_equals(await DeviceMotionEvent.requestPermission(), 'granted');
}

async function create_virtual_sensor() {
  const sensors = ["accelerometer", "linear-acceleration", "gyroscope"];
  for (const item of sensors) {
    await test_driver.create_virtual_sensor(item);
  }
}

var sensor_objects = {};
function create_sensor_objects() {
  sensor_objects.accelerometer = new Accelerometer();
  sensor_objects.linear_acceleration = new LinearAccelerationSensor();
  sensor_objects.gyroscope = new Gyroscope();
}

var sensor_event_watchers = {};
function create_event_watcher(t) {
  const event_types = ['activate', 'reading', 'error'];
  const sensors = ["accelerometer", "linear_acceleration", "gyroscope"];
  for (const item of sensors) {
    sensor_event_watchers[item] = new EventWatcher(t, sensor_objects[item], event_types);
  }
}

async function createVirtualSensors(t) {
  await set_permissions();
  await create_virtual_sensor();
  create_sensor_objects();
  create_event_watcher(t);
}

// If two doubles differ by less than this amount, we can consider them
// to be effectively equal.
const EPSILON = 1e-8;

function generateMotionData(accelerationX, accelerationY, accelerationZ,
                            accelerationIncludingGravityX,
                            accelerationIncludingGravityY,
                            accelerationIncludingGravityZ,
                            rotationRateAlpha, rotationRateBeta, rotationRateGamma,
                            interval = 16) {
  const motionData = {accelerationX: accelerationX,
                    accelerationY: accelerationY,
                    accelerationZ: accelerationZ,
                    accelerationIncludingGravityX: accelerationIncludingGravityX,
                    accelerationIncludingGravityY: accelerationIncludingGravityY,
                    accelerationIncludingGravityZ: accelerationIncludingGravityZ,
                    rotationRateAlpha: rotationRateAlpha,
                    rotationRateBeta: rotationRateBeta,
                    rotationRateGamma: rotationRateGamma,
                    interval: interval};
  return motionData;
}

function generateOrientationData(alpha, beta, gamma, absolute) {
  const orientationData = {alpha: alpha,
                         beta: beta,
                         gamma: gamma,
                         absolute: absolute};
  return orientationData;
}

var sensor_started = {'accelerometer': false, 'linear-acceleration': false, 'gyroscope': false};
async function setMockSensorDataForType(sensorProvider, sensorType, mockDataArray) {
  var type;
  var sensor;
  switch (sensorType) {
    case "Accelerometer":
      type = 'accelerometer';
      sensor = 'accelerometer';
      break;
    case "LinearAccelerationSensor":
      type = 'linear-acceleration';
      sensor = 'linear_acceleration';
      break;
    case "Gyroscope":
      type = 'gyroscope';
      sensor = 'gyroscope';
      break;
    default:
      console.log(`Illegal sensorType ${sensorType}.`);
      return;
    }

    if(!sensor_started[type]) {
      sensor_objects[sensor].start();
      assert_false(sensor_objects[sensor].hasReading);
      await sensor_event_watchers[sensor].wait_for('activate');
      sensor_started[type] = true;
    }
    await Promise.all([
        test_driver.update_virtual_sensor(type, {"x":mockDataArray[0],"y":mockDataArray[1],"z":mockDataArray[2]}),
        sensor_event_watchers[sensor].wait_for('reading')
      ]);
    assert_true(sensor_objects[sensor].hasReading);
}

// Device[Orientation|Motion]EventPump treat NaN as a missing value.
let nullToNan = x => (x === null ? NaN : x);

async function setMockMotionData(sensorProvider, motionData) {
  const degToRad = Math.PI / 180;
  return Promise.all([
      setMockSensorDataForType(sensorProvider, "Accelerometer", [
          nullToNan(motionData.accelerationIncludingGravityX),
          nullToNan(motionData.accelerationIncludingGravityY),
          nullToNan(motionData.accelerationIncludingGravityZ),
      ]),
      setMockSensorDataForType(sensorProvider, "LinearAccelerationSensor", [
          nullToNan(motionData.accelerationX),
          nullToNan(motionData.accelerationY),
          nullToNan(motionData.accelerationZ),
      ]),
      setMockSensorDataForType(sensorProvider, "Gyroscope", [
          nullToNan(motionData.rotationRateAlpha) * degToRad,
          nullToNan(motionData.rotationRateBeta) * degToRad,
          nullToNan(motionData.rotationRateGamma) * degToRad,
      ]),
  ]);
}

function setMockOrientationData(sensorProvider, orientationData) {
  let sensorType = orientationData.absolute
      ? "AbsoluteOrientationEulerAngles" : "RelativeOrientationEulerAngles";
  return setMockSensorDataForType(sensorProvider, sensorType, [
      nullToNan(orientationData.beta),
      nullToNan(orientationData.gamma),
      nullToNan(orientationData.alpha),
  ]);
}

function assertEventEquals(actualEvent, expectedEvent) {
  for (let key1 of Object.keys(Object.getPrototypeOf(expectedEvent))) {
    if (typeof expectedEvent[key1] === "object" && expectedEvent[key1] !== null) {
      assertEventEquals(actualEvent[key1], expectedEvent[key1]);
    } else if (typeof expectedEvent[key1] === "number") {
      assert_approx_equals(actualEvent[key1], expectedEvent[key1], EPSILON, key1);
    } else {
      assert_equals(actualEvent[key1], expectedEvent[key1], key1);
    }
  }
}

function getExpectedOrientationEvent(expectedOrientationData) {
  return new DeviceOrientationEvent('deviceorientation', {
    alpha: expectedOrientationData.alpha,
    beta: expectedOrientationData.beta,
    gamma: expectedOrientationData.gamma,
    absolute: expectedOrientationData.absolute,
  });
}

function getExpectedAbsoluteOrientationEvent(expectedOrientationData) {
  return new DeviceOrientationEvent('deviceorientationabsolute', {
    alpha: expectedOrientationData.alpha,
    beta: expectedOrientationData.beta,
    gamma: expectedOrientationData.gamma,
    absolute: expectedOrientationData.absolute,
  });
}

function getExpectedMotionEvent(expectedMotionData) {
  return new DeviceMotionEvent('devicemotion', {
    acceleration: {
      x: expectedMotionData.accelerationX,
      y: expectedMotionData.accelerationY,
      z: expectedMotionData.accelerationZ,
    },
    accelerationIncludingGravity: {
      x: expectedMotionData.accelerationIncludingGravityX,
      y: expectedMotionData.accelerationIncludingGravityY,
      z: expectedMotionData.accelerationIncludingGravityZ,
    },
    rotationRate: {
      alpha: expectedMotionData.rotationRateAlpha,
      beta: expectedMotionData.rotationRateBeta,
      gamma: expectedMotionData.rotationRateGamma,
    },
    interval: expectedMotionData.interval,
  });
}

function waitForEvent(expected_event) {
  return new Promise((resolve, reject) => {
    window.addEventListener(expected_event.type, (event) => {
      try {
        assertEventEquals(event, expected_event);
        resolve();
      } catch (e) {
        reject(e);
      }
    }, { once: true });
  });
}
