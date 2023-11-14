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

// Adds a dummy devicemotion/deviceorientation callback for the entirety of a
// test.
//
// The calls to test_driver.update_virtual_sensor() in
// setMockSensorDataForType() only have an effect if the underlying sensors are
// active.
// The spec gives implementations some leeway on when to start them, so we can
// only count on it when at least one event listener has been added, and even
// then we need to make sure any asynchronous steps have completed, so we also
// need to wait for a non-zero sampling frequency.
// This function, together with setMock{Motion,Orientation}Data(), ensures both
// conditions are true before attempting to create data to trigger the firing
// of an event.
function startFetchingEventData(t, name) {
  const dummyCallback = () => {};
  window.addEventListener(name, dummyCallback);
  t.add_cleanup(() => { window.removeEventListener('devicemotion', dummyCallback) });
}

async function create_virtual_sensor() {
  const sensors = ["accelerometer", "linear-acceleration", "gyroscope"];
  for (const item of sensors) {
    await test_driver.create_virtual_sensor(item);
  }
}

async function createVirtualSensors() {
  await set_permissions();
  await create_virtual_sensor();
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

async function setMockSensorDataForType(sensorProvider, sensorType, mockDataArray) {
  await Promise.all([
    test_driver.update_virtual_sensor(sensorType, {"x":mockDataArray[0],"y":mockDataArray[1],"z":mockDataArray[2]}),
  ]);
}

// Device[Orientation|Motion]EventPump treat NaN as a missing value.
let nullToNan = x => (x === null ? NaN : x);

async function setMockMotionData(t, sensorProvider, motionData) {
  async function virtual_sensor_is_active(name) {
    const info = await test_driver.get_virtual_sensor_information(name);
    return info.requestedSamplingFrequency !== 0;
  }
  await Promise.all([
    t.step_wait(async () => virtual_sensor_is_active('accelerometer')),
    t.step_wait(async () => virtual_sensor_is_active('linear-acceleration')),
    t.step_wait(async () => virtual_sensor_is_active('gyroscope')),
  ]);

  const degToRad = Math.PI / 180;
  return Promise.all([
      setMockSensorDataForType(sensorProvider, "accelerometer", [
          nullToNan(motionData.accelerationIncludingGravityX),
          nullToNan(motionData.accelerationIncludingGravityY),
          nullToNan(motionData.accelerationIncludingGravityZ),
      ]),
      setMockSensorDataForType(sensorProvider, "linear-acceleration", [
          nullToNan(motionData.accelerationX),
          nullToNan(motionData.accelerationY),
          nullToNan(motionData.accelerationZ),
      ]),
      setMockSensorDataForType(sensorProvider, "gyroscope", [
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
