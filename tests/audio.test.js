import test from 'node:test';
import assert from 'node:assert/strict';
import {crossfadeLoopSamples,shipEngineMix} from '../src/audio.js';

test('Kıyı 28 (Motorbot) procedural outboard frequency scaling with speed & throttle', () => {
  const calcBoatHz = (speed, throttle, airborne = false) => {
    const maxBoatSpeed = 21.0;
    const speedRatio = Math.min(1, Math.max(0, speed / maxBoatSpeed));
    let targetHz = 28 + throttle * 25 + speedRatio * 82;
    if (airborne && throttle > 0.2) {
      targetHz = Math.min(155, targetHz * 1.22);
    }
    return targetHz;
  };

  // Standstill idle
  const idleHz = calcBoatHz(0, 0);
  assert.strictEqual(idleHz, 28);

  // Standstill revving
  const revvingHz = calcBoatHz(0, 1);
  assert.strictEqual(revvingHz, 53);

  // Cruising at 10 knots
  const cruisingHz = calcBoatHz(10.5, 1);
  assert.strictEqual(cruisingHz, 94);

  // Max speed at 21 knots
  const maxHz = calcBoatHz(21, 1);
  assert.strictEqual(maxHz, 135);

  // Smooth progressive rise with speed
  assert(idleHz < revvingHz);
  assert(revvingHz < cruisingHz);
  assert(cruisingHz < maxHz);
});

test('Outboard underwater exhaust muffler filter dynamics', () => {
  const calcMufflerCutoff = (speed, throttle) => {
    const maxBoatSpeed = 21.0;
    const speedRatio = Math.min(1, Math.max(0, speed / maxBoatSpeed));
    return 260 + speedRatio * 680 + throttle * 220;
  };

  const idleCutoff = calcMufflerCutoff(0, 0);
  const fullCutoff = calcMufflerCutoff(21, 1);

  assert.strictEqual(idleCutoff, 260); // Muffled underwater purr at rest
  assert.strictEqual(fullCutoff, 1160); // Open throaty roar at full speed
  assert(fullCutoff > idleCutoff);
});

test('Mavi 52 crossfades four real engine states while keeping speed pitch changes subtle', () => {
  const idle = shipEngineMix(0, 0);
  const low = shipEngineMix(0, 0.28);
  const mid = shipEngineMix(0, 0.62);
  const full = shipEngineMix(13, 1);

  assert.strictEqual(idle.frequency, 14);
  assert.strictEqual(full.frequency, 42);
  assert.strictEqual(idle.playbackRate, 0.99);
  assert(Math.abs(full.playbackRate - 1.015) < 0.001);
  assert.deepStrictEqual(idle.weights, [1, 0, 0, 0]);
  assert.deepStrictEqual(full.weights, [0, 0, 0, 1]);
  assert(low.weights[0] > 0 && low.weights[1] > 0);
  assert(mid.weights[1] > 0 && mid.weights[2] > 0);
  for (const mix of [idle, low, mid, full]) {
    assert(Math.abs(mix.weights.reduce((sum, weight) => sum + weight ** 2, 0) - 1) < 0.001);
  }
  assert.strictEqual(idle.synthGain, 0.035);
  assert(shipEngineMix(13, 1, [false, false, false, false]).synthGain > full.synthGain);
});

test('missing Mavi 52 engine recording blends between the nearest recordings', () => {
  const mix = shipEngineMix(0, 0.5, [true, false, true, true]);

  assert.strictEqual(mix.weights[1], 0);
  assert(mix.weights[0] > 0 && mix.weights[2] > 0);
  assert(Math.abs(mix.weights.reduce((sum, weight) => sum + weight ** 2, 0) - 1) < 0.001);
});

test('ship engine loop crossfade avoids a jump at the loop boundary', () => {
  const samples = Float32Array.from({length:1024}, (_, i) => Math.sin(i * Math.PI * 2 / 128));
  const loop = crossfadeLoopSamples(samples, 80);

  assert.strictEqual(loop.length, 944);
  assert(Math.abs(loop[0] - loop.at(-1)) < 0.06);
  assert(loop.every(Number.isFinite));
});

test('Hull water wake rush gain and filter scaling with speed', () => {
  const calcWake = (speed, isShip = false) => {
    const maxSpeed = isShip ? 13.0 : 21.0;
    const ratio = Math.min(1, speed / maxSpeed);
    return {
      gain: ratio * (isShip ? 0.3 : 0.48),
      freq: 350 + ratio * 750,
    };
  };

  const restWake = calcWake(0);
  const fullWake = calcWake(21);

  assert.strictEqual(restWake.gain, 0);
  assert.strictEqual(restWake.freq, 350);
  assert(Math.abs(fullWake.gain - 0.48) < 0.001);
  assert.strictEqual(fullWake.freq, 1100);
  assert(Math.abs(calcWake(13, true).gain - 0.3) < 0.001);
});

test('Free-spinning propeller rev flare when airborne over waves', () => {
  const calcBoatHz = (speed, throttle, airborne = false) => {
    const maxBoatSpeed = 21.0;
    const speedRatio = Math.min(1, Math.max(0, speed / maxBoatSpeed));
    let targetHz = 28 + throttle * 25 + speedRatio * 82;
    if (airborne && throttle > 0.2) {
      targetHz = Math.min(155, targetHz * 1.22);
    }
    return targetHz;
  };

  const waterHz = calcBoatHz(18, 1, false);
  const airHz = calcBoatHz(18, 1, true);

  assert(airHz > waterHz);
  assert(airHz <= 155);
});

test('Wave impact and hull slap trigger threshold', () => {
  function checkImpact(impact, lastImpact, cooldown) {
    if (impact > 0.8 && cooldown <= 0 && (impact - lastImpact > 0.35 || impact > 1.8)) {
      return true;
    }
    return false;
  }

  assert.strictEqual(checkImpact(0.4, 0.2, 0), false);
  assert.strictEqual(checkImpact(1.2, 0.5, 0), true);
  assert.strictEqual(checkImpact(1.2, 0.5, 0.2), false); // in cooldown
  assert.strictEqual(checkImpact(2.0, 1.9, 0), true); // heavy impact overrides delta
});
