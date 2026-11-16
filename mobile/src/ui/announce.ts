/**
 * Telling the tablet's users what the office changed: an Android notification,
 * and the count on the bell.
 *
 * ── A LOCAL NOTIFICATION, NOT A PUSH ──────────────────────────────────────────
 * The tablet finds out what changed when it refreshes its lists -- on opening,
 * coming back to the front, every ten minutes while open, and in the
 * background when the position tracker wakes it (core/sync/background.ts).
 * It then posts the notification itself. A push from the server would need a
 * Google Firebase project and every tablet to reach Google; this needs
 * neither, and works on a site network that reaches only our own server.
 *
 * Quiet by design: no sound, ordinary priority. Nothing here is urgent enough
 * to interrupt somebody reversing a dumper.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { translate, useLang } from '@/i18n';
import type { Change } from '@/core/notices';
import { summary } from './noticeText';
import { useNotices } from './useNotices';

export const CHANNEL = 'office-updates';
/** Where tapping the notification goes. */
export const NOTICES_ROUTE = '/notices';

/** How a notification shows while the app is open. Called once, at module scope. */
export function configureNotifications(): void {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false,
      }),
    });
  } catch { /* no notifications module in this runtime (Expo Go) */ }
}

async function language() {
  const st = useLang.getState();
  if (!st.ready) await st.load();
  return useLang.getState().lang;
}

async function channel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const lang = await language();
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: translate(lang, 'Updates from the office'),
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: null,
  });
}

/**
 * Ask once whether the app may post notifications. Android 13 and later asks
 * the person; earlier versions allow it. A refusal is final until changed in
 * Android's settings, and costs nothing here: the bell still counts.
 */
export async function askToNotify(): Promise<boolean> {
  try {
    await channel();   // Android shows its question only once a channel exists
    const now = await Notifications.getPermissionsAsync();
    if (now.granted) return true;
    if (!now.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * Say what changed. Never throws: a notification that could not be posted
 * is still on the Updates screen, which is what matters.
 */
export async function announce(changes: Change[]): Promise<void> {
  void useNotices.getState().refresh();
  if (!changes.length) return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await channel();
    const lang = await language();
    const t = (english: string, vars?: Record<string, string | number | null | undefined>) =>
      translate(lang, english, vars);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: t('Updates from the office'),
        body: summary(changes, t),
        data: { to: NOTICES_ROUTE },
      },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
    });
  } catch { /* see above */ }
}

/** Once somebody has seen the list, the notifications about it go. */
export async function clearPosted(): Promise<void> {
  try { await Notifications.dismissAllNotificationsAsync(); } catch { /* nothing to clear */ }
}
