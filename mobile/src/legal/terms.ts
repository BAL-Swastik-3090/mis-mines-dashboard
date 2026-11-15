/**
 * The terms of use of the HOTO tablet app, shown before the app is first used
 * and again whenever TERMS_VERSION changes.
 *
 * ── A DRAFT FOR THE COMPANY'S LEGAL TEAM ─────────────────────────────────────
 * Written to be read by the people who hold the tablet: short numbered
 * sections, plain words. It must be reviewed by the Company's legal and HR
 * teams before go-live, and two things in it are deliberately left for them:
 * the Grievance Officer's name and contact (DPDP Act, s. 8(10)), and how long
 * the records are kept (the Company's records-retention policy). Neither is
 * invented here.
 *
 * The English text governs. The summary is shown in the reader's language so
 * that an operator who reads Odia, Hindi or Bengali knows what they are
 * agreeing to; a full translation by a qualified translator is a next step.
 *
 * Bump TERMS_VERSION whenever the text changes in substance: every tablet then
 * asks again before it can be used.
 */

export const TERMS_VERSION = '1.0';
export const TERMS_DATE = '16 November 2026';

/** Shown in the reader's language (translated like every other screen). */
export const SUMMARY: string[] = [
  'This app and this tablet belong to Balasore Alloys Limited. Use them only for handover records at Kaliapani Chromite Mines.',
  'What you confirm becomes a safety record. Enter only what you have checked yourself, at the machine.',
  'If a check that stops the machine fails, do not work the machine. Tell your supervisor at once.',
  'The app records names, employee numbers, photographs, readings, times and, where the office has turned it on, where the tablet is.',
  'These records are used for safety, maintenance and the mine\'s statutory records, and are seen only by people who need them.',
  'Keep the tablet safe. Report a lost or damaged tablet to IT straight away.',
];

export interface Section { title: string; body: string[] }

/** The full text, in English. */
export const TERMS: Section[] = [
  { title: '1. About these terms', body: [
    'These terms govern the use of the HOTO (handover and takeover) application and the tablet on which it is installed (together, "the App"). The App and the tablet are provided by Balasore Alloys Limited ("the Company") for use at Kaliapani Chromite Mines.',
    'By selecting "I agree" you confirm that you have read these terms, that you are authorised by the Company to set up or use this tablet, and that the people who use it will be told of these terms. Everyone who uses the App is bound by them.',
  ] },
  { title: '2. Who may use the App', body: [
    'The App may be used only by employees, contract workers and supervisors whom the Company has authorised to record machine handovers, and only on a tablet that the Company\'s IT department has approved.',
    'Do not let anyone else use the App in your name, and do not record a handover in another person\'s name. Choose your own name under "Filled in by" whenever you fill in a handover for someone else.',
  ] },
  { title: '3. Purpose', body: [
    'The App is for recording the condition of machines when they change hands between shifts, during a shift, and when they are parked: the checks made, the faults found, meter and fuel readings, and the people involved.',
    'It must not be used for any other purpose. No personal apps, files or photographs may be kept on the tablet.',
  ] },
  { title: '4. Accuracy and your confirmation', body: [
    'When you confirm a handover you declare that the information is true and complete to the best of your knowledge, and that the checks were made at the machine at that time.',
    'Handover records form part of the mine\'s safety and maintenance records and may be relied on by the Company, by contractors and by authorities with powers under the Mines Act, 1952 and the rules and regulations made under it. A false, careless or copied entry may endanger lives and may lead to action under the Company\'s standing orders and service rules, and under the law.',
  ] },
  { title: '5. Safety comes first', body: [
    'The App does not replace the mine\'s safety rules, the statutory duties of any person, or the instructions of your supervisor.',
    'If a check marked "Stops the machine" fails, the machine must not be operated until it has been repaired and released, whatever the App shows. Report it to your supervisor at once.',
    'Never use the tablet while operating a machine, while a machine is moving near you, or in any place or manner that is unsafe.',
  ] },
  { title: '6. Information the App records', body: [
    'To serve the purpose in section 3 the App records: the names and employee numbers of the operators and of the person filling in the handover; a photograph of the operator at the machine; photographs of faults; answers to each check; meter and fuel readings; remarks; the date and time; and the tablet\'s identity.',
    'Where the Company\'s IT department has turned on location reporting for this tablet, the tablet\'s location is recorded with each handover and at intervals while the tablet is in use, including when the App is not on screen. Location reporting follows the tablet, which is Company property; it is not used to follow anyone outside their work.',
  ] },
  { title: '7. How the information is used and kept', body: [
    'The information is processed by the Company for purposes of employment and the safe operation of the mine, as permitted by section 7 of the Digital Personal Data Protection Act, 2023: to keep handover, safety and maintenance records, to get faults repaired, to confirm who handed over each machine, to meet statutory obligations, and to investigate incidents.',
    'It is available only to Company personnel and service providers who need it for those purposes, and to authorities such as the Directorate General of Mines Safety where the law requires. It is not sold or used for advertising.',
    'It is kept for as long as those purposes and the law require, under the Company\'s records-retention policy, and then deleted or anonymised.',
    'Until it reaches the Company\'s servers, handover information is held on the tablet in an encrypted database, and photographs in storage that only the App can open. A handover discarded before it is confirmed is deleted from the tablet; a note that it was discarded, and why, is kept.',
  ] },
  { title: '8. Your rights', body: [
    'You may ask to see the information the App holds about you, ask for an error to be corrected, and raise a grievance about how it is handled, under the Digital Personal Data Protection Act, 2023 and the Company\'s policies.',
    'Contact the IT department at Kaliapani Chromite Mines, or the Grievance Officer named by the Company on its notice boards and intranet. You may also approach the Data Protection Board of India once you have used the Company\'s grievance process.',
  ] },
  { title: '9. Looking after the tablet', body: [
    'Keep the tablet clean, charged and with you or locked away. Do not install apps, change its settings, remove its protections or connect it to unknown devices or networks.',
    'Report a lost, stolen or damaged tablet to IT at once. The Company may block the tablet from its servers, and anything on it that has not yet been sent may then be lost.',
  ] },
  { title: '10. Monitoring', body: [
    'The App, the tablet and everything recorded on them belong to the Company. The Company may check how they are used, keep logs of who did what and when, and update or withdraw the App at any time.',
  ] },
  { title: '11. Changes to these terms', body: [
    'The Company may change these terms. When it does, the App will show the new terms and ask for them to be accepted before it can be used again.',
  ] },
  { title: '12. General', body: [
    'These terms are in addition to the Company\'s standing orders, service rules, IT and security policies, and the terms of any contract under which you work. If they conflict, the Company\'s policies and the law prevail.',
    'These terms are governed by the laws of India. The English text governs; a translation is provided for convenience only.',
  ] },
];
