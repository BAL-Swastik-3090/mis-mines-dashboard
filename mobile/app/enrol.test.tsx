/**
 * Setting a device up, as the person holding a new phone meets it: their name
 * and whose the device is, then the pairing code the office will ask for.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockRequestAccess = jest.fn(async () => ({
  ok: true as const, deviceCode: 'DEV-009', message: 'Waiting to be allowed.', pairingCode: '482913',
}));
// A check that cannot reach the office: still waiting, and no code in it.
const mockCheckAccess = jest.fn(async () => ({
  state: 'waiting' as const, deviceCode: 'DEV-009', message: 'No network', problem: 'No network',
}));

jest.mock('@/core/sync/enrolment', () => ({
  requestAccess: (...a: unknown[]) => (mockRequestAccess as any)(...a),
  checkAccess: () => (mockCheckAccess as any)(),
  joinState: async () => ({ state: 'unregistered' }),
  describeDevice: () => 'Test Phone · Android 14',
  storedBaseUrl: async () => 'http://127.0.0.1:8990',
  setBaseUrlOverride: async () => undefined,
  trackingSettings: async () => ({ track: false, intervalS: 300 }),
}));
jest.mock('@/core/location/tracker', () => ({ applyTrackingSettings: async () => undefined }));
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn() }) }));

import Join from './enrol';

beforeEach(() => { mockRequestAccess.mockClear(); mockCheckAccess.mockClear(); });

describe('setting up a new device', () => {
  it('asks whose the device is before it asks for access', async () => {
    render(<Join />);
    await waitFor(() => screen.getByTestId('who'));
    fireEvent.changeText(screen.getByTestId('who'), 'Prakash Parida');
    fireEvent.press(screen.getByTestId('ask'));
    expect(mockRequestAccess).not.toHaveBeenCalled();
    expect(screen.getByText('Say whose device this is')).toBeTruthy();
  });

  it('a name is enough: the employee number is optional', async () => {
    render(<Join />);
    await waitFor(() => screen.getByTestId('who'));
    fireEvent.changeText(screen.getByTestId('who'), 'Prakash Parida');
    fireEvent.press(screen.getByTestId('own-phone'));
    await act(async () => { fireEvent.press(screen.getByTestId('ask')); });
    expect(mockRequestAccess).toHaveBeenCalledWith('Prakash Parida', '', { emp: '', ownDevice: true });
  });

  it('shows the pairing code the office will ask for, and keeps it with no signal', async () => {
    render(<Join />);
    await waitFor(() => screen.getByTestId('who'));
    fireEvent.changeText(screen.getByTestId('who'), 'Prakash Parida');
    fireEvent.press(screen.getByTestId('company-tablet'));
    await act(async () => { fireEvent.press(screen.getByTestId('ask')); });

    expect(screen.getByTestId('pairing-code')).toBeTruthy();
    expect(screen.getByText('482 913')).toBeTruthy();
    // The waiting screen checks straight away; that check could not reach the
    // office and carried no code. The code must still be there to read out.
    await waitFor(() => expect(mockCheckAccess).toHaveBeenCalled());
    expect(screen.getByText('482 913')).toBeTruthy();
  });
});
