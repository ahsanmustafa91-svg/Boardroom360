// Demo data for "Demo Company Limited". Everything here is fictional.
'use strict';
const { ensureCredentials } = require('./auth');

function seed() {
  const state = buildSeed();
  ensureCredentials(state);
  return state;
}

function buildSeed() {
  const users = [
    { id: 'u_chair', name: 'Tariq Hameed', title: 'Chairman', role: 'chairman', email: 'tariq.hameed@democo.pk', mobile: '+92 300 1112233', voting: true },
    { id: 'u_d1', name: 'Ayesha Siddiqui', title: 'Independent Director', role: 'director', email: 'ayesha.siddiqui@democo.pk', mobile: '+92 321 4455667', voting: true },
    { id: 'u_d2', name: 'Kamran Qureshi', title: 'Non-Executive Director', role: 'director', email: 'kamran.qureshi@democo.pk', mobile: '+92 333 7788990', voting: true },
    { id: 'u_d3', name: 'Dr. Farah Naz', title: 'Independent Director', role: 'director', email: 'farah.naz@democo.pk', mobile: '+92 345 2233445', voting: true },
    { id: 'u_d4', name: 'Usman Malik', title: 'Non-Executive Director', role: 'director', email: 'usman.malik@democo.pk', mobile: '', voting: true },
    { id: 'u_ceo', name: 'Bilal Ahmed', title: 'Chief Executive Officer', role: 'ceo', email: 'bilal.ahmed@democo.pk', mobile: '+92 300 9988776', voting: true },
    { id: 'u_cs', name: 'Sana Javed', title: 'Company Secretary', role: 'cs', email: 'sana.javed@democo.pk', mobile: '+92 322 5566778', voting: false },
    { id: 'u_csa', name: 'Hamza Ali', title: 'CS Assistant', role: 'csa', email: 'hamza.ali@democo.pk', mobile: '+92 311 6677889', voting: false },
  ];

  const bodies = [
    { id: 'board', name: 'Board of Directors', short: 'Board', code: 'BOD', chair: 'u_chair', members: ['u_chair', 'u_d1', 'u_d2', 'u_d3', 'u_d4', 'u_ceo'], fee: 100000 },
    { id: 'audit', name: 'Audit Committee', short: 'Audit Committee', code: 'AC', chair: 'u_d1', members: ['u_d1', 'u_d2', 'u_d4'], fee: 50000 },
    { id: 'hr', name: 'HR & Remuneration Committee', short: 'HR&R Committee', code: 'HRC', chair: 'u_d3', members: ['u_d3', 'u_chair', 'u_d2', 'u_ceo'], fee: 50000 },
  ];

  const allOf = (b) => bodies.find((x) => x.id === b).members;
  const present = (b, except = []) => Object.fromEntries(allOf(b).map((u) => [u, except.includes(u) ? 'apologies' : 'present']));
  const votesAll = (b, choice = 'for') => Object.fromEntries(allOf(b).filter((u) => users.find((x) => x.id === u).voting).map((u) => [u, choice]));

  const meetings = [];
  const papers = [];
  const resolutions = [];
  const notices = [];
  const fees = {};

  function addPaper(meetingId, itemId, title, pages) {
    const id = `p_${meetingId}_${itemId}`;
    papers.push({ id, meetingId, itemId, title, pages, readBy: {} });
    return id;
  }

  // ---------- Archive: Board meetings 22 to 24 (held, minutes signed) ----------
  const archived = [
    {
      id: 'm_bod22', number: 22, date: '2026-03-14', items: [
        ['Confirmation of minutes of the 21st meeting', 'info', null],
        ['Approval of annual audited financial statements FY2026', 'decision', 'RESOLVED THAT the audited financial statements for the year ended 30 June 2026 be and are hereby approved and authorised for issue.'],
        ['Recommendation of final cash dividend', 'decision', 'RESOLVED THAT a final cash dividend of PKR 3.50 per share (35%) be recommended to the members for approval at the Annual General Meeting.'],
      ],
    },
    {
      id: 'm_bod23', number: 23, date: '2026-06-20', items: [
        ['Confirmation of minutes of the 22nd meeting', 'info', null],
        ['Approval of annual budget FY2027', 'decision', 'RESOLVED THAT the annual budget for FY2027 with total capital expenditure of PKR 420 million be and is hereby approved.'],
        ['Opening of a bank account with Meezan Bank', 'decision', 'RESOLVED THAT the Company open a current account with Meezan Bank Limited, with the CEO and CFO as joint signatories.'],
      ],
    },
    {
      id: 'm_bod24', number: 24, date: '2026-09-12', items: [
        ['Confirmation of minutes of the 23rd meeting', 'info', null],
        ['Approval of Q1 FY2027 condensed interim financial statements', 'decision', 'RESOLVED THAT the condensed interim financial statements for the quarter ended 30 September 2026 be approved for circulation to members and transmission to SECP and PSX.'],
        ['Appointment of Chief Financial Officer', 'decision', 'RESOLVED THAT Mr. Adnan Rafiq be appointed Chief Financial Officer of the Company with effect from 1 October 2026 on terms recommended by the HR&R Committee.'],
        ['Solar power project at the Lahore plant', 'decision', 'RESOLVED THAT the 2.5 MW rooftop solar project at the Lahore plant at a cost not exceeding PKR 310 million be and is hereby approved.'],
      ],
    },
  ];
  archived.forEach((a, ai) => {
    const agenda = a.items.map((it, i) => ({
      id: `i${i + 1}`, no: i + 1, title: it[0], type: it[1], presenter: i === 0 ? 'u_cs' : 'u_ceo',
      resolutionText: it[2], votes: it[1] === 'decision' ? votesAll('board') : {}, voteOpen: false,
      outcome: it[1] === 'decision' ? 'passed' : 'noted', discussion: '',
    }));
    const attendance = present('board', ai === 1 ? ['u_d4'] : []);
    meetings.push({
      id: a.id, body: 'board', number: a.number, title: `${ordinal(a.number)} meeting of the Board of Directors`,
      date: a.date, time: '11:00', venue: 'Board Room, Head Office, Lahore', videoLink: 'https://teams.microsoft.com/l/meetup-join/demo',
      status: 'closed', agendaApproved: true, poll: null, rsvps: {}, attendance, agenda, liveItem: null,
      minutes: {
        status: 'signed', text: draftMinutesText({ body: 'board', number: a.number, date: a.date, agenda, attendance }, users, bodies),
        signatures: { u_chair: a.date + 'T15:00:00Z', u_cs: a.date + 'T15:10:00Z' },
      },
    });
    agenda.filter((x) => x.type === 'decision').forEach((x) => {
      resolutions.push({
        id: `r_${a.id}_${x.id}`, ref: `BOD/${a.number}/${String(x.no).padStart(2, '0')}`, meetingId: a.id, body: 'board',
        title: x.title, text: x.resolutionText, passedOn: a.date, tally: tally(x.votes), mode: 'meeting',
      });
    });
    addPaper(a.id, 'i2', a.items[1][0], [`Paper for item 2 of the ${ordinal(a.number)} meeting.`, 'Archived board paper. Sealed and kept permanently.']);
    fees[a.id] = Object.fromEntries(Object.entries(attendance).filter(([, s]) => s === 'present').map(([u]) => [u, 'paid']));
  });

  // ---------- Audit Committee 13: held, minutes circulated, awaiting signatures ----------
  const ac13Agenda = [
    { id: 'i1', no: 1, title: 'Review of Q1 FY2027 interim financial statements', type: 'decision', presenter: 'u_ceo', resolutionText: 'RESOLVED THAT the Committee recommends the Q1 FY2027 interim financial statements to the Board for approval.', votes: votesAll('audit'), voteOpen: false, outcome: 'passed', discussion: '' },
    { id: 'i2', no: 2, title: 'Internal audit report on procurement', type: 'info', presenter: 'u_cs', resolutionText: null, votes: {}, voteOpen: false, outcome: 'noted', discussion: 'Management to close the three high-risk findings by 31 December 2026.' },
  ];
  const ac13Att = present('audit');
  meetings.push({
    id: 'm_ac13', body: 'audit', number: 13, title: '13th meeting of the Audit Committee', date: '2026-10-22', time: '10:00',
    venue: 'Committee Room 2, Head Office, Lahore', videoLink: 'https://zoom.us/j/demo', status: 'held', agendaApproved: true, poll: null,
    rsvps: {}, attendance: ac13Att, agenda: ac13Agenda, liveItem: null,
    minutes: { status: 'circulated', text: draftMinutesText({ body: 'audit', number: 13, date: '2026-10-22', agenda: ac13Agenda, attendance: ac13Att }, users, bodies), signatures: {} },
  });
  resolutions.push({ id: 'r_m_ac13_i1', ref: 'AC/13/01', meetingId: 'm_ac13', body: 'audit', title: ac13Agenda[0].title, text: ac13Agenda[0].resolutionText, passedOn: '2026-10-22', tally: tally(ac13Agenda[0].votes), mode: 'meeting' });
  fees.m_ac13 = { u_d1: 'paid', u_d2: 'due', u_d4: 'due' };

  // ---------- Audit Committee 14: scheduled, notice issued, papers out ----------
  const ac14 = {
    id: 'm_ac14', body: 'audit', number: 14, title: '14th meeting of the Audit Committee', date: '2026-12-03', time: '10:00',
    venue: 'Committee Room 2, Head Office, Lahore', videoLink: 'https://zoom.us/j/demo-ac14', status: 'scheduled', agendaApproved: true, poll: null,
    rsvps: { u_d1: 'in_person' }, attendance: {}, liveItem: null, minutes: null,
    agenda: [
      { id: 'i1', no: 1, title: 'Confirmation of minutes of the 13th meeting', type: 'info', presenter: 'u_cs' },
      { id: 'i2', no: 2, title: 'Appointment of external auditors for FY2027', type: 'decision', presenter: 'u_ceo', resolutionText: 'RESOLVED THAT the Committee recommends to the Board the appointment of A.F. Rahman & Co., Chartered Accountants, as external auditors for FY2027 at a fee of PKR 6.8 million.' },
      { id: 'i3', no: 3, title: 'Related party transactions for the quarter', type: 'decision', presenter: 'u_ceo', resolutionText: 'RESOLVED THAT the related party transactions for the quarter ended 30 September 2026 be recommended to the Board for approval.' },
      { id: 'i4', no: 4, title: 'Any other business with the permission of the Chair', type: 'info', presenter: 'u_d1' },
    ].map(fillItem),
  };
  meetings.push(ac14);
  addPaper('m_ac14', 'i2', 'Appointment of external auditors FY2027', [
    'Purpose: to recommend the appointment of external auditors for FY2027.',
    'Background: three firms on the SECP panel of QCR-rated firms submitted proposals. Proposals were evaluated on audit approach, sector experience, team and fee.',
    'Evaluation: A.F. Rahman & Co. scored 86/100, K. Saleem & Co. 81/100 and Haider Shah & Co. 77/100. The recommended fee is PKR 6.8 million, 6% higher than FY2026.',
    'Recommendation: that the Committee recommends A.F. Rahman & Co. to the Board for appointment at the AGM.',
  ]);
  addPaper('m_ac14', 'i3', 'Related party transactions Q1 FY2027', [
    'Purpose: to review related party transactions for the quarter ended 30 September 2026.',
    'Summary: sales to associated company PKR 84.2 million; purchases from associated company PKR 31.7 million; all at arm\'s length under the approved pricing policy.',
    'Recommendation: that the Committee recommends the transactions to the Board for approval.',
  ]);
  notices.push({
    id: 'n_ac14', ref: 'B360/AC/14/01', meetingId: 'm_ac14', kind: 'original', linkedTo: null, status: 'issued',
    createdAt: '2026-11-17T09:00:00Z', issuedAt: '2026-11-18T09:30:00Z', issuedBy: 'u_cs', note: '',
    recipients: {
      u_d1: { deliveredAt: '2026-11-18T09:30:05Z', openedAt: '2026-11-18T10:02:00Z', acknowledgedAt: '2026-11-18T10:03:00Z', reply: 'in_person', reminders: 0 },
      u_d2: { deliveredAt: '2026-11-18T09:30:05Z', openedAt: '2026-11-18T18:40:00Z', acknowledgedAt: null, reply: null, reminders: 0 },
      u_d4: { deliveredAt: '2026-11-18T09:30:05Z', openedAt: null, acknowledgedAt: null, reply: null, reminders: 0 },
    },
  });

  // ---------- HR&R Committee 8: scheduled, ready to run live ----------
  const hr8 = {
    id: 'm_hr8', body: 'hr', number: 8, title: '8th meeting of the HR & Remuneration Committee', date: '2026-11-27', time: '15:00',
    venue: 'Board Room, Head Office, Lahore', videoLink: 'https://meet.google.com/demo-hr8', status: 'scheduled', agendaApproved: true, poll: null,
    rsvps: {}, attendance: {}, liveItem: null, minutes: null,
    agenda: [
      { id: 'i1', no: 1, title: 'Annual salary increments FY2027', type: 'decision', presenter: 'u_ceo', resolutionText: 'RESOLVED THAT an average merit increase of 12% for management staff be recommended to the Board.' },
      { id: 'i2', no: 2, title: 'Succession plan for key positions', type: 'info', presenter: 'u_ceo' },
    ].map(fillItem),
  };
  meetings.push(hr8);
  addPaper('m_hr8', 'i1', 'Annual salary increments FY2027', [
    'Purpose: to recommend annual increments for management staff.',
    'Inflation (CPI, last 12 months) averaged 9.8%. Market survey shows median increases of 11 to 13% in the sector.',
    'Recommendation: average merit increase of 12%, range 8 to 18% based on performance ratings. Cost: PKR 96 million a year.',
  ]);
  notices.push({
    id: 'n_hr8', ref: 'B360/HRC/08/01', meetingId: 'm_hr8', kind: 'original', linkedTo: null, status: 'issued',
    createdAt: '2026-11-12T09:00:00Z', issuedAt: '2026-11-13T11:00:00Z', issuedBy: 'u_cs', note: '',
    recipients: Object.fromEntries(['u_d3', 'u_chair', 'u_d2', 'u_ceo'].map((u) => [u, { deliveredAt: '2026-11-13T11:00:04Z', openedAt: u === 'u_chair' ? null : '2026-11-13T12:00:00Z', acknowledgedAt: u === 'u_d3' ? '2026-11-13T12:01:00Z' : null, reply: u === 'u_d3' ? 'in_person' : null, reminders: 0 }])),
  });

  // ---------- Board 25: date poll open, agenda awaiting Chairman approval ----------
  meetings.push({
    id: 'm_bod25', body: 'board', number: 25, title: '25th meeting of the Board of Directors', date: null, time: '11:00',
    venue: 'Board Room, Head Office, Lahore', videoLink: 'https://teams.microsoft.com/l/meetup-join/demo-bod25', status: 'polling', agendaApproved: false,
    poll: {
      options: ['2027-01-14', '2027-01-18', '2027-01-20'], closesOn: '2027-01-06',
      responses: {
        u_d1: { '2027-01-14': 'no', '2027-01-18': 'yes', '2027-01-20': 'yes' },
        u_d3: { '2027-01-14': 'yes', '2027-01-18': 'yes', '2027-01-20': 'maybe' },
        u_ceo: { '2027-01-14': 'yes', '2027-01-18': 'yes', '2027-01-20': 'no' },
      },
    },
    rsvps: {}, attendance: {}, liveItem: null, minutes: null,
    agenda: [
      { id: 'i1', no: 1, title: 'Confirmation of minutes of the 24th meeting', type: 'info', presenter: 'u_cs' },
      { id: 'i2', no: 2, title: 'Approval of half-yearly financial statements to 31 December 2026', type: 'decision', presenter: 'u_ceo', resolutionText: 'RESOLVED THAT the condensed interim financial statements for the half year ended 31 December 2026 be approved for circulation to members and transmission to SECP and PSX.' },
      { id: 'i3', no: 3, title: 'Appointment of external auditors (on Audit Committee recommendation)', type: 'decision', presenter: 'u_d1', resolutionText: 'RESOLVED THAT the appointment of A.F. Rahman & Co. as external auditors for FY2027 be recommended to the members at the next general meeting.' },
      { id: 'i4', no: 4, title: 'Business plan 2027 to 2029', type: 'info', presenter: 'u_ceo' },
    ].map(fillItem),
  });
  addPaper('m_bod25', 'i4', 'Business plan 2027 to 2029', [
    'Purpose: to present the three-year business plan for discussion.',
    'Revenue target: PKR 18.5 billion by FY2029 (CAGR 14%), driven by exports to the GCC and new product lines.',
    'Capex: PKR 1.9 billion over three years, of which 40% on energy efficiency.',
    'Key risks: exchange rate, energy costs and interest rates.',
  ]);

  const compliance = [
    { id: 'c1', title: 'Annual return (Form A) to SECP', ref: 'Companies Act 2017, s.130', due: '2026-11-30', status: 'pending' },
    { id: 'c2', title: 'Quarterly accounts Q1 FY2027 transmitted to SECP and PSX', ref: 'Companies Act 2017, s.237', due: '2026-10-30', status: 'filed' },
    { id: 'c3', title: 'Change in CFO notified to PSX', ref: 'PSX Rule Book 5.6.1', due: '2026-10-01', status: 'filed' },
    { id: 'c4', title: 'Statement of compliance with the Code of Corporate Governance', ref: 'Listed Companies (CCG) Regulations 2019', due: '2026-10-07', status: 'filed' },
    { id: 'c5', title: 'Directors\' training certification (one director pending)', ref: 'CCG Regulations 2019, reg. 19', due: '2027-06-30', status: 'pending' },
    { id: 'c6', title: 'Minutes of AC 13th meeting signed within 30 days', ref: 'Companies Act 2017, s.178', due: '2026-11-21', status: 'pending' },
  ];

  return {
    version: 1,
    company: {
      name: 'Demo Company Limited', shortName: 'Demo Co.', regNo: '0012345', address: '14-B Main Boulevard, Gulberg III, Lahore',
      type: 'listed', rulePack: 'PK-CA2017-listed',
    },
    rulePacks: {
      'PK-CA2017-listed': { label: 'Pakistan, Companies Act 2017 (listed company)', noticeDays: 7, quorum: 'one-third or four, whichever is higher', quorumMin: 4, quorumFraction: 1 / 3, minutesSignDays: 30 },
      'PK-CA2017-private': { label: 'Pakistan, Companies Act 2017 (private company)', noticeDays: 7, quorum: 'one-third or two, whichever is higher', quorumMin: 2, quorumFraction: 1 / 3, minutesSignDays: 30 },
      'PK-PSC-rules': { label: 'Pakistan, Public Sector Companies (CG) Rules', noticeDays: 7, quorum: 'one-third or four, whichever is higher', quorumMin: 4, quorumFraction: 1 / 3, minutesSignDays: 14 },
    },
    users, bodies, meetings, papers, resolutions, notices, compliance, fees,
    notes: {},
    activity: [{ at: new Date().toISOString(), who: 'system', text: 'Demo data loaded' }],
  };
}

function fillItem(it) {
  return { resolutionText: null, votes: {}, voteOpen: false, outcome: null, discussion: '', ...it };
}

function tally(votes) {
  const t = { for: 0, against: 0, abstain: 0 };
  Object.values(votes || {}).forEach((v) => { if (t[v] !== undefined) t[v]++; });
  return t;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d + (d.length === 10 ? 'T00:00:00Z' : ''));
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function draftMinutesText(m, users, bodies) {
  const body = bodies.find((b) => b.id === m.body);
  const name = (id) => (users.find((u) => u.id === id) || {}).name || id;
  const presentL = Object.entries(m.attendance || {}).filter(([, s]) => s === 'present' || s === 'virtual').map(([u, s]) => `${name(u)}${s === 'virtual' ? ' (by video link)' : ''}`);
  const apol = Object.entries(m.attendance || {}).filter(([, s]) => s === 'apologies' || s === 'absent').map(([u]) => name(u));
  const lines = [];
  lines.push(`MINUTES OF THE ${ordinal(m.number).toUpperCase()} MEETING OF THE ${body.name.toUpperCase()}`);
  lines.push(`held on ${fmtDate(m.date)}`);
  lines.push('');
  lines.push(`Present: ${presentL.join(', ') || 'none recorded'}`);
  if (apol.length) lines.push(`Leave of absence: ${apol.join(', ')}`);
  lines.push(`In attendance: ${name('u_cs')} (Company Secretary)`);
  lines.push('');
  lines.push(`The Chair, ${name(body.chair)}, called the meeting to order. The quorum was present.`);
  if (m.agendaVote && m.agendaVote.status !== 'open') {
    const vs = Object.values(m.agendaVote.votes || {});
    const ap = vs.filter((v) => v === 'approve').length;
    lines.push(`The agenda was ${m.agendaVote.status === 'approved' ? 'approved' : 'not approved'} by the members present (${ap} approve, ${vs.length - ap} object).`);
  }
  lines.push('');
  m.agenda.forEach((it) => {
    lines.push(`${it.no}. ${it.title}`);
    if (it.discussion) lines.push(`   ${it.discussion}`);
    if (it.type === 'decision') {
      const t = tally(it.votes);
      if (it.outcome === 'passed') lines.push(`   ${it.resolutionText || 'The item was approved.'}`);
      else if (it.outcome === 'not_passed') lines.push('   The resolution was not passed.');
      else if (it.outcome === 'deferred') lines.push('   The item was deferred to the next meeting.');
      lines.push(`   Votes: ${t.for} for, ${t.against} against, ${t.abstain} abstained.`);
    } else {
      lines.push(`   ${it.outcome === 'deferred' ? 'Deferred to the next meeting.' : 'The item was noted.'}`);
    }
    lines.push('');
  });
  lines.push('There being no other business, the meeting ended with a vote of thanks to the Chair.');
  return lines.join('\n');
}

module.exports = { seed, tally, ordinal, fmtDate, draftMinutesText, fillItem };
