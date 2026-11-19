/**
 * The terms screen as the person setting up a tablet meets it: the summary in
 * their language, saying no, and agreeing only once the box is ticked.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
// Icons load a font at runtime; here they are only decoration.
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));

import { TermsScreen } from './Terms';
import { useTerms } from '@/legal/acceptance';
import { useLang } from '@/i18n';
import { TERMS_VERSION } from '@/legal/terms';

const metrics = { frame: { x: 0, y: 0, width: 800, height: 1280 },
                  insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const show = (mode: 'accept' | 'read') => render(
  <SafeAreaProvider initialMetrics={metrics}><TermsScreen mode={mode} /></SafeAreaProvider>);

beforeEach(() => {
  useTerms.setState({ ready: true, accepted: null });
  useLang.setState({ lang: 'en' });
});

describe('the terms of use, before the app can be used', () => {
  it('agreeing does nothing until the box is ticked', () => {
    show('accept');
    fireEvent.press(screen.getByTestId('terms-accept'));
    expect(useTerms.getState().accepted).toBeNull();
  });

  it('ticking the box and agreeing records this version', async () => {
    show('accept');
    fireEvent.press(screen.getByTestId('terms-tick'));
    await act(async () => { fireEvent.press(screen.getByTestId('terms-accept')); });
    expect(useTerms.getState().accepted?.version).toBe(TERMS_VERSION);
  });

  it('saying no explains that the app cannot be used, and lets them read again', () => {
    show('accept');
    fireEvent.press(screen.getByTestId('terms-decline'));
    expect(screen.getByTestId('terms-declined')).toBeTruthy();
    expect(screen.queryByTestId('terms-accept')).toBeNull();
    fireEvent.press(screen.getByText('Read the terms again'));
    expect(screen.getByTestId('terms-accept')).toBeTruthy();
    expect(useTerms.getState().accepted).toBeNull();
  });

  it('the summary follows the language chosen on this screen', async () => {
    show('accept');
    await act(async () => { fireEvent.press(screen.getByTestId('terms-lang-or')); });
    expect(useLang.getState().lang).toBe('or');
    expect(screen.getByText('ସଂକ୍ଷେପରେ')).toBeTruthy();                  // "In short"
    expect(screen.getByText(/ବାଲେଶ୍ୱର ଆଲଏଜ ଲିମିଟେଡର/)).toBeTruthy();
    // The full terms stay in English, and say so.
    expect(screen.getByText('1. About these terms')).toBeTruthy();
    expect(screen.getByText(/ଇଂରାଜୀ ପାଠ ହିଁ ମାନ୍ୟ/)).toBeTruthy();
  });
});

describe('the terms of use, read again from Settings', () => {
  it('has nothing to agree to, and says when they were accepted', () => {
    useTerms.setState({ ready: true, accepted: { version: TERMS_VERSION, at: '2026-11-16T03:07:00Z' } });
    show('read');
    expect(screen.queryByTestId('terms-accept')).toBeNull();
    expect(screen.getByText(/Accepted on this tablet on 16 Nov 2026, version 1.0/)).toBeTruthy();
  });
});
