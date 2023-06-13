// DO NOT EDIT! This test has been generated by /html/canvas/tools/gentest.py.
// OffscreenCanvas test in a worker:2d.path.stroke.union
// Description:Strokes in opposite directions are unioned, not subtracted
// Note:

importScripts("/resources/testharness.js");
importScripts("/html/canvas/resources/canvas-tests.js");

var t = async_test("Strokes in opposite directions are unioned, not subtracted");
var t_pass = t.done.bind(t);
var t_fail = t.step_func(function(reason) {
    throw reason;
});
t.step(function() {

  var canvas = new OffscreenCanvas(100, 50);
  var ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f00';
  ctx.fillRect(0, 0, 100, 50);

  ctx.strokeStyle = '#0f0';
  ctx.lineWidth = 40;
  ctx.moveTo(0, 10);
  ctx.lineTo(100, 10);
  ctx.moveTo(100, 40);
  ctx.lineTo(0, 40);
  ctx.stroke();

  _assertPixel(canvas, 50,25, 0,255,0,255);
  t.done();
});
done();
