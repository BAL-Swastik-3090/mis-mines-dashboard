/**
 * Counting in words, because "1 photo(s)" is how software says nobody
 * finished this screen — on an app asking somebody to certify a machine safe.
 */
import { plural, pluralWord, verb } from './words';

test('one of something takes the singular', () => {
  expect(plural(1, 'photograph')).toBe('1 photograph');
  expect(plural(1, 'handover')).toBe('1 handover');
});

test('any other count takes the plural', () => {
  expect(plural(0, 'photograph')).toBe('0 photographs');
  expect(plural(6, 'photograph')).toBe('6 photographs');
});

test('an irregular plural is given, not guessed', () => {
  expect(plural(2, 'person', 'people')).toBe('2 people');
  expect(plural(1, 'person', 'people')).toBe('1 person');
});

test('the word alone, for a sentence that supplies its own count', () => {
  expect(pluralWord(1, 'photograph')).toBe('photograph');
  expect(pluralWord(3, 'photograph')).toBe('photographs');
});

test('the verb agrees with the count', () => {
  expect(verb(1)).toBe('is');
  expect(verb(2)).toBe('are');
  expect(verb(1, 'belongs', 'belong')).toBe('belongs');
  expect(verb(6, 'belongs', 'belong')).toBe('belong');
});
