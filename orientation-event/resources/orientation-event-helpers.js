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

async function setMotionSensorsPermissions() {
  await test_driver.set_permission({name: 'accelerometer'}, 'granted');
  await test_driver.set_permission({name: 'gyroscope'}, 'granted');
  return test_driver.bless('enable user activation', async () => {
    const permission = await DeviceMotionEvent.requestPermission();
    assert_equals(permission, 'granted');
  });
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

const dummyCallback = () => {};

function startFetchingEventData(t, name) {
  window.addEventListener(name, dummyCallback);
  t.add_cleanup(() => { window.removeEventListener('devicemotion', dummyCallback) });
}

async function createVirtualSensors(params) {
  for (const [sensor, connected] of params) {
    await test_driver.create_virtual_sensor(sensor, {"connected": connected});
  }
}

async function removeVirtualSensors(sensors) {
  for (const item of sensors) {
    await test_driver.remove_virtual_sensor(item);
  }
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

// Device[Orientation|Motion]EventPump treat NaN as a missing value.
let nullToNan = x => (x === null ? NaN : x);
let nullToZero = x => (x === null ? 0 : x);

async function setMockMotionData(t, motionData, isAccelerometerConnected,
                                 isLinearAccelerometerConnected,
                                 isGyroscopeConnected) {
  async function virtual_sensor_is_active(name) {
    const info = await test_driver.get_virtual_sensor_information(name);
    return info.requestedSamplingFrequency !== 0;
  }

  if (isAccelerometerConnected === true) {
    await Promise.all([t.step_wait(() => virtual_sensor_is_active('accelerometer'))]);
  }

  if (isLinearAccelerometerConnected === true) {
    await Promise.all([t.step_wait(() => virtual_sensor_is_active('linear-acceleration'))]);
  }

  if (isGyroscopeConnected === true) {
    await Promise.all([t.step_wait(() => virtual_sensor_is_active('gyroscope'))]);
  }

  const degToRad = Math.PI / 180;
  return Promise.all([
    test_driver.update_virtual_sensor('accelerometer', {
        "x":nullToZero(motionData.accelerationIncludingGravityX),
        "y":nullToZero(motionData.accelerationIncludingGravityY),
        "z":nullToZero(motionData.accelerationIncludingGravityZ),
    }),
    test_driver.update_virtual_sensor('linear-acceleration', {
        "x":nullToZero(motionData.accelerationX),
        "y":nullToZero(motionData.accelerationY),
        "z":nullToZero(motionData.accelerationZ),
    }),
    test_driver.update_virtual_sensor('gyroscope', {
        "x":nullToZero(motionData.rotationRateAlpha) * degToRad,
        "y":nullToZero(motionData.rotationRateBeta) * degToRad,
        "z":nullToZero(motionData.rotationRateGamma) * degToRad,
    }),
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
  console.log('JV666 assertEventEquals ' + JSON.stringify(actualEvent), JSON.stringify(expectedEvent));
  for (let key1 of Object.keys(Object.getPrototypeOf(expectedEvent))) {
    if (typeof expectedEvent[key1] === "object" && expectedEvent[key1] !== null) {
      console.log('JV666 assertEventEquals 1 ' + actualEvent[key1], expectedEvent[key1]);
      assertEventEquals(actualEvent[key1], expectedEvent[key1]);
    } else if (typeof expectedEvent[key1] === "number") {
      console.log('JV666 assertEventEquals 2 ' + JSON.stringify(actualEvent[key1]), JSON.stringify(expectedEvent[key1]));
      assert_approx_equals(actualEvent[key1], expectedEvent[key1], EPSILON, key1);
    } else {
      console.log('JV666 assertEventEquals 3 ' + JSON.stringify(actualEvent[key1]), JSON.stringify(expectedEvent[key1]));
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
