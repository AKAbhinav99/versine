/* Intake: the questions a clinician asks that a photograph cannot answer.
 *
 * Kept deliberately separate from the measurement. Nothing here moves the
 * screening bands, and no answer is folded into a combined risk score. There is
 * no data behind such a score, and inventing one would repeat the mistake this
 * app already corrected once when the depth-derived rotation estimate turned out
 * to be noise dressed up as a number.
 *
 * So the answers do two narrow things instead:
 *
 *   red flags     symptoms that warrant a clinician regardless of what the photo
 *                 measured. A level-shouldered photo does not make leg weakness
 *                 unimportant, and this app should never be the reason someone
 *                 waits.
 *
 *   risk factors  context carried onto the referral summary. Family history and
 *                 growth remaining are what decide whether a small curve is
 *                 watched or acted on, and neither is visible in an image.
 */

const STORE_KEY = 'versine.intake.v1';

/* `flag` marks an answer that is a red flag, with how fast it needs looking at.
   'urgent' is for symptoms that can mean spinal cord involvement rather than a
   curve, those are a same-week call, not a note for the next check-up. */
export const QUESTIONS = [
  {
    id: 'age',
    section: 'growth',
    type: 'number',
    prompt: 'Age',
    help: 'Idiopathic curves usually appear between 10 and 15. A curve found much earlier is a different situation clinically, and worth saying out loud.',
    min: 1,
    max: 110,
  },
  {
    id: 'growing',
    section: 'growth',
    prompt: 'Grown noticeably taller in the last year?',
    help: 'Curves progress while the spine is still growing, and stop being likely to once it is not. This is the single biggest factor in whether a small curve is watched or braced.',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'unsure', label: 'Not sure' },
    ],
  },
  {
    id: 'family',
    section: 'growth',
    prompt: 'Scoliosis in a parent, sibling, or grandparent?',
    help: 'Scoliosis runs in families. A first-degree relative with a curve raises the odds substantially, which is why clinicians always ask.',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'unsure', label: 'Not sure' },
    ],
  },
  {
    id: 'menarche',
    section: 'growth',
    prompt: 'If applicable, have periods started?',
    help: 'Growth largely finishes about two years after they begin, so this dates how much spine growth is left. Skip it if it does not apply.',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'Not yet' },
      { value: 'na', label: 'Not applicable' },
    ],
  },

  {
    id: 'nightPain',
    section: 'flags',
    prompt: 'Back pain that wakes you at night?',
    help: 'Ordinary idiopathic scoliosis is usually painless. Pain that wakes someone is the kind clinicians investigate separately from the curve.',
    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
    flag: { on: 'yes', urgency: 'prompt', label: 'Back pain that wakes you at night' },
  },
  {
    id: 'neuro',
    section: 'flags',
    prompt: 'Numbness, tingling, or weakness in your legs or feet?',
    help: 'These point at the nerves rather than the shape of the spine, and they are not something to monitor at home.',
    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
    flag: { on: 'yes', urgency: 'urgent', label: 'Numbness, tingling, or weakness in the legs' },
  },
  {
    id: 'bladder',
    section: 'flags',
    prompt: 'New trouble controlling your bladder or bowels?',
    help: 'Rare, and the reason it is asked anyway is that it can mean pressure on the spinal cord. It is a same-week call, not a next-check-up mention.',
    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
    flag: { on: 'yes', urgency: 'urgent', label: 'New bladder or bowel control problems' },
  },
  {
    id: 'rapidChange',
    section: 'flags',
    prompt: 'Has your back visibly changed shape in the last few months?',
    help: 'A curve that is moving quickly gets seen sooner than one that has been the same for years. Speed matters as much as size.',
    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
    flag: { on: 'yes', urgency: 'prompt', label: 'Visible change in back shape over recent months' },
  },
];

export const SECTIONS = {
  growth: {
    title: 'Growth and history',
    note: 'These decide how much a curve is likely to change, which is what a clinician weighs alongside its size.',
  },
  flags: {
    title: 'Symptoms',
    note: 'None of these are measured from a photo. They are asked because a reassuring photo should not be the reason someone waits.',
  },
};

/* ---------------------------------------------------------------- storage --- */

export function loadIntake() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.answers ? parsed : { answers: {}, updatedAt: null };
  } catch {
    return { answers: {}, updatedAt: null };
  }
}

export function saveIntake(answers) {
  const record = { answers, updatedAt: Date.now() };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(record)); } catch { /* not persisted */ }
  return record;
}

export function clearIntake() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* nothing to clear */ }
}

/** Has anything been filled in at all? Drives whether the result screen asks. */
export const isAnswered = (answers) =>
  QUESTIONS.some((question) => hasValue(answers[question.id]));

const hasValue = (value) => value !== undefined && value !== null && value !== '';

/* ------------------------------------------------------------ derivations --- */

/**
 * Symptoms that need a clinician whatever the photograph said.
 * @returns {{id:string,label:string,urgency:'urgent'|'prompt'}[]}
 */
export function redFlagsFrom(answers) {
  return QUESTIONS
    .filter((question) => question.flag && answers[question.id] === question.flag.on)
    .map((question) => ({
      id: question.id,
      label: question.flag.label,
      urgency: question.flag.urgency,
    }));
}

export const highestUrgency = (flags) =>
  (flags.some((flag) => flag.urgency === 'urgent') ? 'urgent' : flags.length ? 'prompt' : null);

/**
 * Context for the referral summary. Only things that are actually informative
 * are returned, "no family history" is worth printing, "not sure" is not.
 */
export function riskFactorsFrom(answers) {
  const factors = [];

  if (hasValue(answers.age)) {
    const age = Number(answers.age);
    factors.push({
      label: 'Age',
      value: `${age}`,
      note: age >= 10 && age <= 15
        ? 'Within the usual window for idiopathic curves to appear.'
        : age < 10
          ? 'Younger than the usual idiopathic window. Early-onset curves are worked up differently.'
          : 'Past the usual window for a curve to first appear.',
    });
  }

  if (answers.growing === 'yes') {
    factors.push({ label: 'Still growing', value: 'Yes', note: 'Growth remaining is the main driver of whether a curve progresses.' });
  } else if (answers.growing === 'no') {
    factors.push({ label: 'Still growing', value: 'No apparent growth in the last year', note: 'Progression risk is lower once growth has finished.' });
  }

  if (answers.family === 'yes') {
    factors.push({ label: 'Family history', value: 'Yes', note: 'A close relative with scoliosis raises the likelihood of a curve.' });
  } else if (answers.family === 'no') {
    factors.push({ label: 'Family history', value: 'None reported', note: null });
  }

  if (answers.menarche === 'no') {
    factors.push({ label: 'Menarche', value: 'Not yet', note: 'Most spinal growth is still ahead, so a curve has more room to progress.' });
  } else if (answers.menarche === 'yes') {
    factors.push({ label: 'Menarche', value: 'Started', note: 'Growth is typically largely complete about two years after onset.' });
  }

  return factors;
}
