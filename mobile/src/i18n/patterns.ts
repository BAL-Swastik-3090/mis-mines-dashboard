/**
 * Sentences built by the rules in core, with something in them that is not
 * text: a machine, a person, a check's label, a number. The rules keep writing
 * them in English (their tests are the specification); the screen translates
 * them through these. `template` is the dictionary key; `vars` names the
 * captured groups in order.
 *
 * The per-check ones ignore case: the walk-round's own rules write "Say what
 * is wrong", the list of what is left writes "say what is wrong", and they are
 * the same sentence to the operator.
 */

export interface Pattern { re: RegExp; template: string; vars: string[] }

export const PATTERNS: Pattern[] = [
  // ── advisories on the people screen (session.advisoriesFor) ──
  { re: /^(.+) is not signed off on (.+)\. The handover will be recorded and raised for a supervisor\.$/,
    template: '{name} is not signed off on {type}. The handover will be recorded and raised for a supervisor.',
    vars: ['name', 'type'] },
  { re: /^(.+)'s competency for (.+) expired on (.+)\.$/,
    template: "{name}'s competency for {type} expired on {date}.", vars: ['name', 'type', 'date'] },
  { re: /^(.+) has a critical defect against it and should not be worked until it has been verified repaired\.$/,
    template: '{fleet} has a critical defect against it and should not be worked until it has been verified repaired.',
    vars: ['fleet'] },
  { re: /^(.+) has (\d+) open defects? against it\.$/,
    template: '{fleet} has {n} open defects against it.', vars: ['fleet', 'n'] },
  { re: /^This tablet last synced (\d+) day\(s\) ago\. Machine and operator details may have changed\.$/,
    template: 'This tablet last synced {n} days ago. Machine and operator details may have changed.',
    vars: ['n'] },

  // ── what is left before confirming (capture/todo.ts, evaluation.ts) ──
  { re: /^No checklist is published for (.+) on this tablet\. Sync the tablet, or tell the office\.$/,
    template: 'No checklist is published for {type} on this tablet. Sync the tablet, or tell the office.',
    vars: ['type'] },
  { re: /^(.+): not answered$/i, template: '{label}: not answered', vars: ['label'] },
  { re: /^(.+): needs an answer$/i, template: '{label}: not answered', vars: ['label'] },
  { re: /^(.+): say what is wrong, add a photo$/i,
    template: '{label}: say what is wrong, add a photo', vars: ['label'] },
  { re: /^(.+): say what is wrong$/i, template: '{label}: say what is wrong', vars: ['label'] },
  { re: /^(.+): add a photo$/i, template: '{label}: add a photo', vars: ['label'] },
  { re: /^(.+): a critical item cannot be marked not applicable$/i,
    template: '{label}: a critical item cannot be marked not applicable', vars: ['label'] },
  { re: /^(.+): needs a reading$/i, template: '{label}: needs a reading', vars: ['label'] },
  { re: /^Meter reads ([\d.]+), lower than the last ([\d.]+)\. Check it, or say why in the remarks$/,
    template: 'Meter reads {m}, lower than the last {last}. Check it, or say why in the remarks',
    vars: ['m', 'last'] },
  { re: /^Meter reads ([\d.]+) but was last ([\d.]+) — check the reading, or say why in the remarks$/,
    template: 'Meter reads {m}, lower than the last {last}. Check it, or say why in the remarks',
    vars: ['m', 'last'] },

  // ── what a send reported (sync/engine.ts) ──
  { re: /^The office did not accept this tablet \((.*)\)\. Nothing has been lost: the handovers stay here and go once that is put right\.$/,
    template: 'The office did not accept this tablet ({why}). Nothing has been lost: the handovers stay here and go once that is put right.',
    vars: ['why'] },
  { re: /^A handover was refused: (.*)$/, template: 'A handover was refused: {why}', vars: ['why'] },
];
