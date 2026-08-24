/* Tests for the intake derivations.
 *
 * The rule these protect: intake answers never touch the measurement. They can
 * raise a flag and they can add context, and that is the whole contract — if a
 * future change starts folding answers into a score, these should be the tests
 * that make that a deliberate act rather than a quiet one. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  QUESTIONS, redFlagsFrom, riskFactorsFrom, highestUrgency, isAnswered,
} from '../src/lib/intake.js';

test('no answers means no flags and no factors', () => {
  assert.deepEqual(redFlagsFrom({}), []);
  assert.deepEqual(riskFactorsFrom({}), []);
  assert.equal(highestUrgency([]), null);
  assert.equal(isAnswered({}), false);
});

test('a reassuring answer is not a flag', () => {
  const answers = { nightPain: 'no', neuro: 'no', bladder: 'no', rapidChange: 'no' };
  assert.deepEqual(redFlagsFrom(answers), []);
  assert.equal(isAnswered(answers), true);
});

test('neurological symptoms outrank pain in urgency', () => {
  const flags = redFlagsFrom({ nightPain: 'yes', neuro: 'yes' });
  assert.equal(flags.length, 2);
  assert.equal(highestUrgency(flags), 'urgent');
});

test('night pain alone is prompt, not urgent', () => {
  assert.equal(highestUrgency(redFlagsFrom({ nightPain: 'yes' })), 'prompt');
});

test('bladder and bowel changes are always urgent', () => {
  assert.equal(highestUrgency(redFlagsFrom({ bladder: 'yes' })), 'urgent');
});

test('growth and family history come through as factors, not as flags', () => {
  const answers = { growing: 'yes', family: 'yes', age: 13 };
  assert.deepEqual(redFlagsFrom(answers), []);

  const labels = riskFactorsFrom(answers).map((factor) => factor.label);
  assert.deepEqual(labels, ['Age', 'Still growing', 'Family history']);
});

test('an age inside the idiopathic window is noted as such', () => {
  const inside = riskFactorsFrom({ age: 13 })[0];
  const outside = riskFactorsFrom({ age: 34 })[0];
  assert.match(inside.note, /within the usual window/i);
  assert.match(outside.note, /past the usual window/i);
});

test('"not sure" is carried as an answer but never as a finding', () => {
  const answers = { family: 'unsure', growing: 'unsure' };
  assert.equal(isAnswered(answers), true);
  assert.deepEqual(riskFactorsFrom(answers), []);
  assert.deepEqual(redFlagsFrom(answers), []);
});

test('every flagged question offers the answer that trips it', () => {
  for (const question of QUESTIONS.filter((q) => q.flag)) {
    const values = question.options.map((option) => option.value);
    assert.ok(values.includes(question.flag.on),
      `${question.id} can never be flagged: no option has value "${question.flag.on}"`);
    assert.ok(['urgent', 'prompt'].includes(question.flag.urgency),
      `${question.id} has an unknown urgency`);
  }
});

test('every question has help text explaining why it is asked', () => {
  for (const question of QUESTIONS) {
    assert.ok(question.help?.length > 20, `${question.id} has no explanation`);
  }
});
