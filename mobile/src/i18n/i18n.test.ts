/**
 * Every sentence the tablet shows has a translation, with the same blanks.
 *
 * keys.json is written by scripts/i18n_keys.py from the screens themselves.
 * A sentence added to a screen without its Hindi, Odia and Bengali fails here
 * once the script is re-run, instead of showing up in English on a tablet in
 * a cab. A translation that drops or renames a {placeholder} would show the
 * raw "{name}" to the operator; that fails here too.
 */

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

import KEYS from './keys.json';
import { hi } from './hi';
import { or } from './or';
import { bn } from './bn';
import { PATTERNS } from './patterns';
import { translate, translateMessage } from './index';

const DICTS = { hi, or, bn };
const blanks = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe.each(Object.entries(DICTS))('%s', (_lang, dict) => {
  it('translates every sentence on the screens', () => {
    expect((KEYS as string[]).filter((k) => !(k in dict))).toEqual([]);
  });

  it('keeps every {blank} of the English, and adds none', () => {
    const wrong = Object.entries(dict).filter(([en, tr]) =>
      JSON.stringify(blanks(en)) !== JSON.stringify(blanks(tr)));
    expect(wrong).toEqual([]);
  });

  it('is not English left in place', () => {
    // Codes, units and "OK" stay as they are; a whole sentence should not.
    const same = Object.entries(dict).filter(([en, tr]) => en === tr && /\s\w+\s/.test(en));
    expect(same).toEqual([]);
  });
});

describe('patterns', () => {
  it('each template is a sentence in the list', () => {
    for (const p of PATTERNS) expect(KEYS).toContain(p.template);
  });

  it('a check left over keeps its own label and translates the rest', () => {
    expect(translateMessage('hi', 'Brake pedal: say what is wrong, add a photo'))
      .toBe('Brake pedal: लिखें क्या गड़बड़ है, फोटो जोड़ें');
    // The walk-round's own rules write it with a capital; same sentence.
    expect(translateMessage('or', 'Horn: Needs an answer')).toBe('Horn: ଉତ୍ତର ଦିଆଯାଇନାହିଁ');
  });

  it('numbers in an advisory survive', () => {
    expect(translateMessage('bn', 'MAN-11 has 3 open defects against it.'))
      .toBe('MAN-11-এ 3টি খোলা ত্রুটি আছে।');
    expect(translateMessage('hi',
      'Meter reads 1200, lower than the last 1250. Check it, or say why in the remarks'))
      .toBe('मीटर 1200 दिखा रहा है, पिछली 1250 से कम। जाँचें, या टिप्पणी में कारण लिखें');
  });

  it('a message nobody has translated is shown in English, not blank', () => {
    expect(translateMessage('hi', 'Could not refresh the machine list (502).'))
      .toBe('Could not refresh the machine list (502).');
  });
});

describe('translate', () => {
  it('fills the blanks', () => {
    expect(translate('or', 'Check {n} of {total}', { n: 3, total: 22 })).toBe('22ରୁ ଯାଞ୍ଚ 3');
  });

  it('falls back to the English for a sentence with no translation', () => {
    expect(translate('bn', 'A sentence written today', {})).toBe('A sentence written today');
  });

  it('English is the English', () => {
    expect(translate('en', 'Keep {name}', { name: 'Prakash' })).toBe('Keep Prakash');
  });
});
