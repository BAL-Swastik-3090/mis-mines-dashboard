/**
 * What each notice says, in the reader's language.
 *
 * Shared by the Updates screen and the Android notification, so the two can
 * never word the same change differently. Takes the caller's t() -- the
 * screen's from useT(), the notification's from translate() with the
 * tablet's stored language, since it may be posted from a background task
 * with no screen at all.
 */

import type { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Change, NoticeKind } from '@/core/notices';
import { countByKind } from '@/core/notices';

type T = (english: string, vars?: Record<string, string | number | null | undefined>) => string;
type Icon = keyof typeof MaterialCommunityIcons.glyphMap;

/** The one line that says what changed. */
export function headline(c: Change, t: T): string {
  const many = c.n > 1 || c.subject == null;
  switch (c.kind) {
    case 'OPERATOR_ADDED':
      return many ? t('{n} new operators', { n: c.n })
        : t('New operator: {name} ({emp})', { name: c.subject, emp: c.detail });
    case 'OPERATOR_REMOVED':
      return many ? t('{n} operators taken off the list', { n: c.n })
        : t('{name} ({emp}) is no longer on the operator list', { name: c.subject, emp: c.detail });
    case 'MACHINE_ADDED':
      return many ? t('{n} new machines', { n: c.n })
        : t('New machine: {fleet} ({type})', { fleet: c.subject, type: c.detail });
    case 'MACHINE_REMOVED':
      return many ? t('{n} machines taken off the list', { n: c.n })
        : t('{fleet} ({type}) is no longer on the machine list', { fleet: c.subject, type: c.detail });
    case 'CHECKLIST_ADDED':
      return t('New checklist in force: {name}', { name: c.subject });
    case 'CHECKLIST_UPDATED':
      return t('Checklist changed: {name} (version {v})', { name: c.subject, v: c.detail });
    case 'CHECKLIST_REMOVED':
      return t('Checklist no longer in force: {name}', { name: c.subject });
  }
}

/** What it means for somebody doing a handover. */
export function meaning(kind: NoticeKind, t: T): string {
  switch (kind) {
    case 'OPERATOR_ADDED':
      return t('Can now be found by name or employee number in a handover.');
    case 'OPERATOR_REMOVED':
      return t('Can no longer be chosen in a handover.');
    case 'MACHINE_ADDED':
      return t('Can now be scanned or picked for a handover.');
    case 'MACHINE_REMOVED':
      return t('Out of service or moved: it can no longer be picked for a handover.');
    case 'CHECKLIST_ADDED':
      return t('Handovers can now be done on this kind of machine.');
    case 'CHECKLIST_UPDATED':
      return t('New handovers use the new checks. One already started keeps its own.');
    case 'CHECKLIST_REMOVED':
      return t('Handovers on this kind of machine wait until the office puts a checklist in force.');
  }
}

export function icon(kind: NoticeKind): { name: Icon; colour: string } {
  switch (kind) {
    case 'OPERATOR_ADDED': return { name: 'account-plus-outline', colour: '#1e8449' };
    case 'OPERATOR_REMOVED': return { name: 'account-remove-outline', colour: '#8a5a00' };
    case 'MACHINE_ADDED': return { name: 'truck-plus-outline', colour: '#1e8449' };
    case 'MACHINE_REMOVED': return { name: 'truck-remove-outline', colour: '#8a5a00' };
    case 'CHECKLIST_ADDED': return { name: 'clipboard-check-outline', colour: '#1e5f8a' };
    case 'CHECKLIST_UPDATED': return { name: 'clipboard-edit-outline', colour: '#1e5f8a' };
    case 'CHECKLIST_REMOVED': return { name: 'clipboard-remove-outline', colour: '#c0392b' };
  }
}

/**
 * The notification's text: the change itself when there is one, otherwise a
 * count of each kind -- "2 new operators · 1 new machine".
 */
export function summary(changes: Change[], t: T): string {
  if (changes.length === 1 && changes[0]) return headline(changes[0], t);
  const c = countByKind(changes);
  const parts: string[] = [];
  const add = (n: number | undefined, one: string, many: string) => {
    if (n) parts.push(n === 1 ? one : many.replace('{n}', String(n)));
  };
  add(c.OPERATOR_ADDED, t('1 new operator'), t('{n} new operators', { n: '{n}' }));
  add(c.OPERATOR_REMOVED, t('1 operator taken off the list'), t('{n} operators taken off the list', { n: '{n}' }));
  add(c.MACHINE_ADDED, t('1 new machine'), t('{n} new machines', { n: '{n}' }));
  add(c.MACHINE_REMOVED, t('1 machine taken off the list'), t('{n} machines taken off the list', { n: '{n}' }));
  const lists = (c.CHECKLIST_ADDED ?? 0) + (c.CHECKLIST_UPDATED ?? 0) + (c.CHECKLIST_REMOVED ?? 0);
  add(lists, t('1 checklist changed'), t('{n} checklists changed', { n: '{n}' }));
  return parts.join(' · ');
}
