/** Whether the terms on this tablet still cover this build of the app. */

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

import { covers, parseAcceptance } from './acceptance';
import { SUMMARY, TERMS, TERMS_VERSION } from './terms';

describe('accepting the terms of use', () => {
  it('a tablet nobody has set up asks for them', () => {
    expect(covers(null)).toBe(false);
  });

  it('the version accepted is the version in force', () => {
    expect(covers({ version: TERMS_VERSION, at: '2026-11-16T03:00:00Z' })).toBe(true);
  });

  it('a new version is asked for again', () => {
    expect(covers({ version: '0.9', at: '2026-11-01T03:00:00Z' })).toBe(false);
  });

  it('what is stored is read back, and anything else is treated as not accepted', () => {
    expect(parseAcceptance('{"version":"1.0","at":"2026-11-16T03:00:00Z"}'))
      .toEqual({ version: '1.0', at: '2026-11-16T03:00:00Z' });
    expect(parseAcceptance(null)).toBeNull();
    expect(parseAcceptance('not json')).toBeNull();
    expect(parseAcceptance('{"version":1}')).toBeNull();
  });
});

describe('the text', () => {
  it('has a summary and numbered sections, in order', () => {
    expect(SUMMARY.length).toBeGreaterThanOrEqual(5);
    TERMS.forEach((s, i) => expect(s.title.startsWith(`${i + 1}. `)).toBe(true));
  });

  it('names nobody it should not: the grievance contact is left to the Company', () => {
    const all = TERMS.flatMap((s) => s.body).join(' ');
    expect(all).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);   // no invented e-mail address
    expect(all).toMatch(/Grievance Officer named by the Company/);
  });
});
