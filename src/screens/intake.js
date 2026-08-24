/* The intake questions, and where the answers land.
 *
 * Answers save as they are given rather than behind a Save button — this is a
 * form someone fills in while sitting with a worried parent, and losing it to a
 * mistapped back gesture would be its own small cruelty.
 */

import { $, el, append, formatDate } from '../lib/dom.js';
import { showScreen } from '../router.js';
import {
  QUESTIONS, SECTIONS, loadIntake, saveIntake, clearIntake,
  redFlagsFrom, highestUrgency, isAnswered,
} from '../lib/intake.js';

let answers = {};
let returnTo = 'result';
let onSaved = null;

export function initIntake(afterSave) {
  onSaved = afterSave;
  answers = loadIntake().answers;
}

/** @param {string} from screen to return to when the form is dismissed. */
export function openIntake(from = 'result') {
  returnTo = from;
  answers = loadIntake().answers;
  showScreen('intake');
  render();
}

function render() {
  const body = $('#intake-body');
  body.replaceChildren();

  const record = loadIntake();
  const flags = redFlagsFrom(answers);

  append(body,
    el('p', { class: 'small muted', style: 'margin-bottom:var(--space-5)' },
      'Kept on this device with your scans, and printed onto the referral summary so you are not trying to remember it in the room. Answer what you know — a blank is better than a guess.'),
    flags.length ? flagSummary(flags) : null,
    ...Object.entries(SECTIONS).map(([id, section]) => sectionBlock(id, section)),
    el('div', { class: 'stack-sm', style: 'margin-top:var(--space-6)' },
      el('button', { class: 'btn btn--block', onClick: done }, 'Done'),
      record.updatedAt
        ? el('button', {
          class: 'btn btn--quiet btn--block',
          onClick: () => {
            if (!confirm('Clear every answer? Your scans are not affected.')) return;
            clearIntake();
            answers = {};
            render();
          },
        }, 'Clear answers')
        : null),
    record.updatedAt
      ? el('p', { class: 'small muted', style: 'margin-top:var(--space-3);text-align:center' },
        `Last updated ${formatDate(record.updatedAt)}`)
      : null,
  );
}

function done() {
  saveIntake(answers);
  if (typeof onSaved === 'function') onSaved();
  showScreen(returnTo);
}

function sectionBlock(id, section) {
  return el('section', { class: 'intake__section' },
    el('div', { class: 'step-label' },
      el('span', { class: 'step-label__num' }, id === 'flags' ? 'B' : 'A'),
      section.title,
      el('span', { class: 'step-label__rule' })),
    el('p', { class: 'small muted', style: 'margin-bottom:var(--space-4)' }, section.note),
    ...QUESTIONS.filter((question) => question.section === id).map(questionBlock));
}

function questionBlock(question) {
  const isFlagged = question.flag && answers[question.id] === question.flag.on;

  return el('fieldset', { class: 'intake__q', 'data-flagged': isFlagged || null },
    el('legend', { class: 'intake__prompt' }, question.prompt),
    question.type === 'number' ? numberField(question) : optionRow(question),
    el('p', { class: 'intake__help' }, question.help));
}

function numberField(question) {
  return el('div', { class: 'intake__number' },
    el('input', {
      type: 'number',
      class: 'mono',
      inputmode: 'numeric',
      min: question.min,
      max: question.max,
      value: answers[question.id] ?? '',
      'aria-label': question.prompt,
      onInput: (event) => {
        const value = event.target.value.trim();
        answers[question.id] = value === '' ? '' : clamp(Number(value), question);
        saveIntake(answers);
      },
    }),
    el('span', { class: 'small muted' }, 'years'));
}

const clamp = (value, { min, max }) => Math.min(max, Math.max(min, Math.round(value) || min));

/* Radios rather than a select: every choice visible at once, each its own tap
   target, and no dropdown to open one-handed. */
function optionRow(question) {
  const name = `intake-${question.id}`;

  return el('div', { class: 'intake__options', role: 'radiogroup', 'aria-label': question.prompt },
    ...question.options.map((option) => {
      const id = `${name}-${option.value}`;
      const isFlag = question.flag?.on === option.value;

      return el('div', { class: 'intake__option' },
        el('input', {
          type: 'radio',
          id,
          name,
          value: option.value,
          checked: answers[question.id] === option.value,
          onChange: () => {
            answers[question.id] = option.value;
            saveIntake(answers);
            render();
          },
        }),
        el('label', { for: id, 'data-flag': isFlag || null }, option.label));
    }),
    answers[question.id]
      ? el('button', {
        class: 'intake__clear',
        type: 'button',
        onClick: () => { delete answers[question.id]; saveIntake(answers); render(); },
      }, 'Clear')
      : null);
}

/* Shown at the top of the form once something is flagged, so the consequence of
   the answer is visible without scrolling back. */
function flagSummary(flags) {
  const urgency = highestUrgency(flags);

  return el('div', { class: 'redflag', 'data-urgency': urgency },
    el('div', { class: 'label redflag__kicker' },
      urgency === 'urgent' ? 'Contact a clinician this week' : 'Worth a clinician\'s attention'),
    el('p', { class: 'redflag__body' },
      urgency === 'urgent'
        ? 'You have reported a symptom that can mean the spinal cord or nerves are involved rather than the shape of the spine alone. That is not something a photograph screens for, and it should not wait on a scan result.'
        : 'You have reported a symptom that ordinary idiopathic scoliosis usually does not cause. It is worth raising with a clinician regardless of what a photograph measures.'),
    el('ul', { class: 'redflag__list' }, ...flags.map((flag) => el('li', {}, flag.label))));
}

/** For other screens: what to show without duplicating the derivation. */
export function intakeState() {
  const { answers: stored } = loadIntake();
  return {
    answers: stored,
    answered: isAnswered(stored),
    flags: redFlagsFrom(stored),
  };
}
