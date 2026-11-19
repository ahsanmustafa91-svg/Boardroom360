'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { createStore } = require('./store');
const { seed, tally, ordinal, fmtDate, draftMinutesText, fillItem } = require('./seed');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const store = createStore();
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// ---------------- helpers ----------------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (msg, status = 400) => { throw new HttpError(status, msg); };
const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const uid = (p) => `${p}_${crypto.randomBytes(5).toString('hex')}`;
const isStaff = (u) => u.role === 'cs' || u.role === 'csa';
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);

function sign(userId) {
  const exp = Date.now() + 12 * 3600 * 1000;
  const body = `${userId}.${exp}`;
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verify(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, exp, mac] = parts;
  const good = crypto.createHmac('sha256', SECRET).update(`${userId}.${exp}`).digest('base64url');
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  if (Date.now() > Number(exp)) return null;
  return userId;
}

// One-time codes (simulated SMS). Kept in memory; they expire after 5 minutes.
const otps = new Map();
function issueOtp(userId, purpose) {
  const code = String(crypto.randomInt(100000, 999999));
  otps.set(`${userId}:${purpose}`, { code, exp: Date.now() + 5 * 60 * 1000 });
  return code;
}
function checkOtp(userId, purpose, code) {
  const k = `${userId}:${purpose}`;
  const o = otps.get(k);
  if (!o || Date.now() > o.exp) fail('The code has expired. Ask for a new one.');
  if (String(code || '').trim() !== o.code) fail('That code is not correct.');
  otps.delete(k);
}

// Serialise writes: one change at a time.
let chain = Promise.resolve();
function withLock(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

function user(state, id) { return state.users.find((u) => u.id === id); }
function body(state, id) { return state.bodies.find((b) => b.id === id); }
function meeting(state, id) { const m = state.meetings.find((x) => x.id === id); if (!m) fail('Meeting not found', 404); return m; }
function notice(state, id) { const n = state.notices.find((x) => x.id === id); if (!n) fail('Notice not found', 404); return n; }
function item(m, id) { const i = m.agenda.find((x) => x.id === id); if (!i) fail('Agenda item not found', 404); return i; }
function requireStaff(u) { if (!isStaff(u)) fail('Only the Company Secretary\'s office can do this.', 403); }
function requireCS(u) { if (u.role !== 'cs') fail('Only the Company Secretary can do this.', 403); }
function log(state, u, text) {
  state.activity.unshift({ at: nowIso(), who: u ? u.id : 'system', text });
  state.activity = state.activity.slice(0, 200);
}
function rulePack(state) { return state.rulePacks[state.company.rulePack]; }
function quorumNeeded(state, b) {
  const rp = rulePack(state);
  if (b.id !== 'board') return Math.max(2, Math.ceil(b.members.length / 3)); // committees
  return Math.max(rp.quorumMin, Math.ceil(b.members.length * rp.quorumFraction));
}

function noticeChecks(state, n) {
  const m = meeting(state, n.meetingId);
  const b = body(state, m.body);
  const checks = [];
  const days = m.date ? daysBetween(today(), m.date) : null;
  const need = rulePack(state).noticeDays;
  checks.push({ id: 'date', ok: !!m.date, label: m.date ? `Meeting date confirmed: ${fmtDate(m.date)}` : 'Meeting date not yet confirmed' });
  if (n.kind === 'supplementary' || n.kind === 'venue') {
    checks.push({ id: 'period', ok: days !== null && days >= 0, label: `Change notice: meeting is in ${days} days`, });
  } else {
    checks.push({ id: 'period', ok: days !== null && days >= need, label: days === null ? `Notice period: ${need} days needed` : `Notice period: ${days} days before the meeting (at least ${need} needed)` });
  }
  checks.push({ id: 'agenda', ok: !!m.agendaApproved, label: m.agendaApproved ? `Agenda approved by the Chair, ${user(state, b.chair).name}` : `Agenda not yet approved by the Chair, ${user(state, b.chair).name}` });
  const missing = b.members.map((id) => user(state, id)).filter((u) => !u.email || !u.mobile);
  checks.push({ id: 'contacts', ok: missing.length === 0, label: missing.length ? `Missing email or mobile: ${missing.map((u) => u.name).join(', ')}` : 'Every recipient has an email and mobile on file' });
  return checks;
}

function draftNotice(state, m, kind = 'original', linkedTo = null, note = '') {
  const b = body(state, m.body);
  const seq = state.notices.filter((x) => x.meetingId === m.id).length + 1;
  const n = {
    id: uid('n'), ref: `B360/${b.code}/${String(m.number).padStart(2, '0')}/${String(seq).padStart(2, '0')}`, meetingId: m.id,
    kind, linkedTo, status: 'draft', createdAt: nowIso(), issuedAt: null, issuedBy: null, note,
    recipients: {},
  };
  state.notices.push(n);
  return n;
}

// Shape the state for one user: hide private notes of others, drafts from directors, etc.
function viewFor(state, u) {
  const staff = isStaff(u);
  const myBodies = staff ? state.bodies.map((b) => b.id) : state.bodies.filter((b) => b.members.includes(u.id)).map((b) => b.id);
  const meetings = state.meetings.filter((m) => myBodies.includes(m.body));
  const mids = new Set(meetings.map((m) => m.id));
  const notices = state.notices.filter((n) => mids.has(n.meetingId) && (staff || u.role === 'chairman' || (n.status === 'issued' && n.recipients[u.id])));
  return {
    version: state.version,
    today: today(),
    me: u,
    company: state.company,
    rulePack: rulePack(state),
    rulePacks: state.rulePacks,
    users: state.users.map((x) => (staff ? x : { id: x.id, name: x.name, title: x.title, role: x.role, voting: x.voting })),
    bodies: state.bodies,
    meetings: meetings.map((m) => ({ ...m, quorum: quorumNeeded(state, body(state, m.body)) })),
    papers: state.papers.filter((p) => mids.has(p.meetingId)),
    notices: notices.map((n) => ({ ...n, checks: n.status === 'draft' ? noticeChecks(state, n) : undefined })),
    resolutions: state.resolutions.filter((r) => myBodies.includes(r.body)),
    compliance: state.compliance,
    fees: staff ? state.fees : Object.fromEntries(Object.entries(state.fees).map(([k, v]) => [k, v[u.id] ? { [u.id]: v[u.id] } : {}])),
    notes: state.notes[u.id] || {},
    activity: staff ? state.activity.slice(0, 60) : [],
  };
}

// ---------------- actions ----------------
const actions = {
  'poll.respond'(s, u, { meetingId, date, answer }) {
    const m = meeting(s, meetingId);
    if (m.status !== 'polling') fail('This date poll has closed.');
    if (!m.poll.options.includes(date)) fail('Unknown date');
    if (!['yes', 'no', 'maybe'].includes(answer)) fail('Bad answer');
    m.poll.responses[u.id] = { ...(m.poll.responses[u.id] || {}), [date]: answer };
  },
  'poll.close'(s, u, { meetingId, date }) {
    requireStaff(u);
    const m = meeting(s, meetingId);
    if (m.status !== 'polling') fail('Poll already closed');
    if (!m.poll.options.includes(date)) fail('Pick one of the poll dates');
    m.date = date; m.status = 'scheduled'; m.poll.closedDate = date;
    const n = draftNotice(s, m);
    log(s, u, `Closed date poll for ${m.title}: ${fmtDate(date)}. Notice ${n.ref} drafted.`);
    return { noticeId: n.id };
  },
  'meeting.create'(s, u, { bodyId, options, closesOn, venue, videoLink, time }) {
    requireStaff(u);
    const b = body(s, bodyId); if (!b) fail('Unknown body');
    const opts = (options || []).filter(Boolean).sort();
    if (!opts.length) fail('Add at least one proposed date');
    const number = Math.max(0, ...s.meetings.filter((m) => m.body === bodyId).map((m) => m.number)) + 1;
    const m = {
      id: uid('m'), body: bodyId, number, title: `${ordinal(number)} meeting of the ${b.name}`, date: null, time: time || '11:00',
      venue: venue || 'Board Room, Head Office', videoLink: videoLink || '', status: 'polling', agendaApproved: false,
      poll: { options: opts, closesOn: closesOn || opts[0], responses: {} }, rsvps: {}, attendance: {}, liveItem: null, minutes: null,
      agenda: [fillItem({ id: 'i1', no: 1, title: 'Confirmation of minutes of the previous meeting', type: 'info', presenter: 'u_cs' })],
    };
    s.meetings.push(m);
    log(s, u, `Created ${m.title} with a date poll.`);
    return { meetingId: m.id };
  },
  'meeting.update'(s, u, { meetingId, venue, videoLink, time }) {
    requireStaff(u);
    const m = meeting(s, meetingId);
    if (venue !== undefined) m.venue = venue;
    if (videoLink !== undefined) m.videoLink = videoLink;
    if (time !== undefined) m.time = time;
  },
  'agenda.add'(s, u, { meetingId, title, type, presenter, resolutionText, paperTitle, paperBody }) {
    requireStaff(u);
    const m = meeting(s, meetingId);
    if (!['polling', 'scheduled'].includes(m.status)) fail('The agenda is closed for this meeting.');
    if (!title) fail('Give the item a title');
    const id = uid('i');
    m.agenda.push(fillItem({ id, no: m.agenda.length + 1, title, type: type === 'decision' ? 'decision' : 'info', presenter: presenter || 'u_ceo', resolutionText: type === 'decision' ? (resolutionText || null) : null }));
    if (m.agendaApproved) { m.agendaApproved = false; log(s, u, `Agenda of ${m.title} changed; it needs the Chair's approval again.`); }
    if (paperBody) {
      s.papers.push({ id: uid('p'), meetingId, itemId: id, title: paperTitle || title, pages: String(paperBody).split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean), readBy: {} });
    }
  },
  'agenda.remove'(s, u, { meetingId, itemId }) {
    requireStaff(u);
    const m = meeting(s, meetingId);
    if (!['polling', 'scheduled'].includes(m.status)) fail('The agenda is closed for this meeting.');
    m.agenda = m.agenda.filter((x) => x.id !== itemId);
    m.agenda.forEach((x, i) => { x.no = i + 1; });
    s.papers = s.papers.filter((p) => !(p.meetingId === meetingId && p.itemId === itemId));
    m.agendaApproved = false;
  },
  'agenda.approve'(s, u, { meetingId }) {
    const m = meeting(s, meetingId);
    if (body(s, m.body).chair !== u.id) fail('Only the Chair of this body can approve the agenda.', 403);
    m.agendaApproved = true; m.agendaApprovedBy = u.id; m.agendaApprovedAt = nowIso();
    log(s, u, `Chair approved the agenda of ${m.title}.`);
  },
  'notice.draft'(s, u, { meetingId }) {
    requireStaff(u);
    const m = meeting(s, meetingId);
    if (!m.date) fail('Confirm the date first');
    const existing = s.notices.find((n) => n.meetingId === m.id && n.status === 'draft');
    if (existing) return { noticeId: existing.id };
    return { noticeId: draftNotice(s, m).id };
  },
  'notice.update'(s, u, { noticeId, note }) {
    requireStaff(u);
    const n = notice(s, noticeId);
    if (n.status !== 'draft') fail('An issued notice is sealed and cannot be changed.');
    n.note = String(note || '').slice(0, 2000);
  },
  'notice.issue'(s, u, { noticeId, code }) {
    requireCS(u);
    const n = notice(s, noticeId);
    if (n.status !== 'draft') fail('Already issued');
    const bad = noticeChecks(s, n).filter((c) => !c.ok);
    if (bad.length) fail(`Cannot issue yet: ${bad.map((c) => c.label).join('; ')}`);
    checkOtp(u.id, `issue:${noticeId}`, code);
    const m = meeting(s, n.meetingId);
    const at = nowIso();
    n.status = 'issued'; n.issuedAt = at; n.issuedBy = u.id;
    n.recipients = Object.fromEntries(body(s, m.body).members.map((id) => [id, { deliveredAt: at, openedAt: null, acknowledgedAt: null, reply: null, reminders: 0 }]));
    if (n.kind === 'postponement' && n.newDate) { m.date = n.newDate; }
    if (n.kind === 'venue' && n.newVenue) { m.venue = n.newVenue; }
    log(s, u, `Issued notice ${n.ref} to ${Object.keys(n.recipients).length} recipients by email and SMS.`);
  },
  'notice.remind'(s, u, { noticeId, userId }) {
    requireStaff(u);
    const n = notice(s, noticeId);
    const r = n.recipients[userId]; if (!r) fail('Not a recipient');
    r.reminders = (r.reminders || 0) + 1; r.lastReminderAt = nowIso();
    log(s, u, `Reminder sent to ${user(s, userId).name} for notice ${n.ref}.`);
  },
  'notice.open'(s, u, { noticeId }) {
    const n = notice(s, noticeId);
    const r = n.recipients[u.id]; if (!r) return;
    if (!r.openedAt) r.openedAt = nowIso();
  },
  'notice.ack'(s, u, { noticeId, reply }) {
    const n = notice(s, noticeId);
    const r = n.recipients[u.id]; if (!r) fail('This notice was not addressed to you.');
    if (!r.openedAt) r.openedAt = nowIso();
    r.acknowledgedAt = r.acknowledgedAt || nowIso();
    if (reply) {
      if (!['in_person', 'video', 'apologies'].includes(reply)) fail('Bad reply');
      r.reply = reply;
      meeting(s, n.meetingId).rsvps[u.id] = reply;
    }
    log(s, u, `${u.name} acknowledged notice ${n.ref}${reply ? ` (${reply.replace('_', ' ')})` : ''}.`);
  },
  'notice.change'(s, u, { meetingId, kind, newDate, newVenue, note }) {
    requireStaff(u);
    const m = meeting(s, meetingId);
    const orig = s.notices.filter((n) => n.meetingId === m.id && n.status === 'issued').pop();
    if (!orig) fail('There is no issued notice to change.');
    if (!['postponement', 'venue', 'supplementary'].includes(kind)) fail('Unknown change');
    if (kind === 'postponement' && !newDate) fail('Give the new date');
    if (kind === 'venue' && !newVenue) fail('Give the new venue');
    const n = draftNotice(s, m, kind, orig.id, note || '');
    if (newDate) n.newDate = newDate;
    if (newVenue) n.newVenue = newVenue;
    if (kind === 'postponement') m.date = newDate; // the period check runs against the new date
    log(s, u, `Drafted ${kind} notice ${n.ref}, linked to ${orig.ref}.`);
    return { noticeId: n.id };
  },
  'rsvp'(s, u, { meetingId, response }) {
    const m = meeting(s, meetingId);
    if (!body(s, m.body).members.includes(u.id)) fail('You are not a member of this body.');
    if (!['in_person', 'video', 'apologies'].includes(response)) fail('Bad reply');
    m.rsvps[u.id] = response;
  },
  'paper.read'(s, u, { paperId }) {
    const p = s.papers.find((x) => x.id === paperId); if (!p) fail('Paper not found', 404);
    if (!p.readBy[u.id]) p.readBy[u.id] = nowIso();
  },
  'note.save'(s, u, { paperId, text }) {
    s.notes[u.id] = s.notes[u.id] || {};
    s.notes[u.id][paperId] = String(text || '').slice(0, 5000);
    return { quiet: true };
  },
  'live.start'(s, u, { meetingId }) {
    requireStaff(u);
    const m = meeting(s, meetingId);
    if (m.status !== 'scheduled') fail('Only a scheduled meeting can be started.');
    m.status = 'live'; m.liveItem = 0; m.startedAt = nowIso();
    m.attendance = Object.fromEntries(body(s, m.body).members.map((id) => [id, m.rsvps[id] === 'apologies' ? 'apologies' : 'absent']));
    log(s, u, `${m.title} started.`);
  },
  'live.join'(s, u, { meetingId }) {
    const m = meeting(s, meetingId);
    if (m.status !== 'live') fail('The meeting is not live.');
    if (!body(s, m.body).members.includes(u.id)) return;
    if (m.attendance[u.id] !== 'present') m.attendance[u.id] = m.rsvps[u.id] === 'video' ? 'virtual' : 'present';
  },
  'live.attendance'(s, u, { meetingId, userId, status }) {
    requireStaff(u);
    const m = meeting(s, meetingId);
    if (!['present', 'virtual', 'apologies', 'absent'].includes(status)) fail('Bad status');
    m.attendance[userId] = status;
  },
  'live.goto'(s, u, { meetingId, index }) {
    requireStaff(u);
    const m = meeting(s, meetingId);
    if (m.status !== 'live') fail('Not live');
    m.liveItem = Math.max(0, Math.min(m.agenda.length - 1, Number(index)));
  },
  'live.discussion'(s, u, { meetingId, itemId, text }) {
    requireStaff(u);
    item(meeting(s, meetingId), itemId).discussion = String(text || '').slice(0, 4000);
    return { quiet: true };
  },
  'vote.open'(s, u, { meetingId, itemId }) {
    requireStaff(u);
    const m = meeting(s, meetingId);
    if (m.status !== 'live') fail('Not live');
    const present = Object.values(m.attendance).filter((x) => x === 'present' || x === 'virtual').length;
    if (present < quorumNeeded(s, body(s, m.body))) fail(`Quorum not present (${present} of ${quorumNeeded(s, body(s, m.body))} needed).`);
    const it = item(m, itemId);
    it.voteOpen = true; it.votes = {}; it.outcome = null;
  },
  'vote.cast'(s, u, { meetingId, itemId, choice }) {
    const m = meeting(s, meetingId);
    const it = item(m, itemId);
    if (!it.voteOpen) fail('Voting is not open on this item.');
    if (!u.voting || !body(s, m.body).members.includes(u.id)) fail('You do not have a vote on this item.', 403);
    if (!['present', 'virtual'].includes(m.attendance[u.id])) fail('Join the meeting before voting.');
    if (!['for', 'against', 'abstain'].includes(choice)) fail('Bad choice');
    it.votes[u.id] = choice;
  },
  'vote.close'(s, u, { meetingId, itemId }) {
    requireStaff(u);
    const m = meeting(s, meetingId);
    const it = item(m, itemId);
    it.voteOpen = false;
    const t = tally(it.votes);
    it.outcome = t.for > t.against ? 'passed' : 'not_passed';
    log(s, u, `Vote on "${it.title}": ${t.for} for, ${t.against} against, ${t.abstain} abstained. ${it.outcome === 'passed' ? 'Passed' : 'Not passed'}.`);
  },
  'item.outcome'(s, u, { meetingId, itemId, outcome }) {
    requireStaff(u);
    if (!['noted', 'deferred', 'passed', 'not_passed'].includes(outcome)) fail('Bad outcome');
    item(meeting(s, meetingId), itemId).outcome = outcome;
  },
  'live.end'(s, u, { meetingId }) {
    requireStaff(u);
    const m = meeting(s, meetingId);
    if (m.status !== 'live') fail('Not live');
    m.agenda.forEach((it) => { it.voteOpen = false; if (!it.outcome) it.outcome = it.type === 'decision' ? 'deferred' : 'noted'; });
    m.status = 'held'; m.endedAt = nowIso(); m.date = today(); // record the day it was actually held
    m.minutes = { status: 'draft', text: draftMinutesText(m, s.users, s.bodies), signatures: {} };
    const b = body(s, m.body);
    m.agenda.filter((it) => it.type === 'decision' && it.outcome === 'passed').forEach((it) => {
      s.resolutions.push({ id: uid('r'), ref: `${b.code}/${m.number}/${String(it.no).padStart(2, '0')}`, meetingId: m.id, body: m.body, title: it.title, text: it.resolutionText || it.title, passedOn: m.date, tally: tally(it.votes), mode: 'meeting' });
    });
    s.fees[m.id] = Object.fromEntries(Object.entries(m.attendance).filter(([, x]) => x === 'present' || x === 'virtual').map(([id]) => [id, 'due']));
    log(s, u, `${m.title} ended. Draft minutes created and resolutions added to the register.`);
  },
  'minutes.edit'(s, u, { meetingId, text }) {
    requireStaff(u);
    const m = meeting(s, meetingId);
    if (!m.minutes || m.minutes.status === 'signed') fail('Signed minutes are sealed.');
    m.minutes.text = String(text || '');
    if (m.minutes.status === 'circulated') { m.minutes.signatures = {}; }
  },
  'minutes.circulate'(s, u, { meetingId }) {
    requireStaff(u);
    const m = meeting(s, meetingId);
    if (!m.minutes || m.minutes.status !== 'draft') fail('Nothing to circulate');
    m.minutes.status = 'circulated'; m.minutes.circulatedAt = nowIso();
    log(s, u, `Minutes of ${m.title} circulated for signature.`);
  },
  'minutes.sign'(s, u, { meetingId, code }) {
    const m = meeting(s, meetingId);
    const b = body(s, m.body);
    if (!m.minutes || m.minutes.status !== 'circulated') fail('These minutes are not out for signature.');
    if (u.id !== b.chair && u.role !== 'cs') fail('Only the Chair and the Company Secretary sign the minutes.', 403);
    checkOtp(u.id, `sign:${meetingId}`, code);
    m.minutes.signatures[u.id] = nowIso();
    const csId = s.users.find((x) => x.role === 'cs').id;
    if (m.minutes.signatures[b.chair] && m.minutes.signatures[csId]) {
      m.minutes.status = 'signed'; m.status = 'closed';
      const c = s.compliance.find((x) => x.id === 'c6' && m.id === 'm_ac13'); if (c) c.status = 'filed';
      log(s, u, `Minutes of ${m.title} signed by the Chair and the Company Secretary, sealed and archived.`);
    } else log(s, u, `${u.name} signed the minutes of ${m.title}.`);
  },
  'compliance.set'(s, u, { id, status }) {
    requireStaff(u);
    const c = s.compliance.find((x) => x.id === id); if (!c) fail('Not found');
    c.status = status === 'filed' ? 'filed' : 'pending';
  },
  'fees.pay'(s, u, { meetingId, userId }) {
    requireStaff(u);
    if (!s.fees[meetingId] || !s.fees[meetingId][userId]) fail('No fee due');
    s.fees[meetingId][userId] = 'paid';
    log(s, u, `Meeting fee marked paid to ${user(s, userId).name}.`);
  },
  'member.update'(s, u, { userId, email, mobile }) {
    requireStaff(u);
    const x = user(s, userId); if (!x) fail('Not found');
    if (email !== undefined) x.email = String(email).trim();
    if (mobile !== undefined) x.mobile = String(mobile).trim();
    log(s, u, `Contact details updated for ${x.name}.`);
  },
  'settings.rulePack'(s, u, { rulePack }) {
    requireCS(u);
    if (!s.rulePacks[rulePack]) fail('Unknown rule pack');
    s.company.rulePack = rulePack;
    log(s, u, `Rule pack set to ${s.rulePacks[rulePack].label}.`);
  },
};

// ---------------- routes ----------------
function auth(req, res, next) {
  const id = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
  if (!id) return res.status(401).json({ error: 'Please sign in again.' });
  req.userId = id; next();
}
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  if (!(e instanceof HttpError)) console.error(e);
  res.status(e.status || 500).json({ error: e instanceof HttpError ? e.message : 'Something went wrong' });
});

app.get('/healthz', wrap(async (req, res) => res.json({ ok: true, store: await store.kind() })));

app.get('/api/demo-users', wrap(async (req, res) => {
  const s = await store.load();
  res.json({ company: s.company.name, users: s.users.map((u) => ({ id: u.id, name: u.name, title: u.title, role: u.role, mobile: u.mobile ? u.mobile.replace(/\d(?=\d{3})/g, '•') : '' })) });
}));

app.post('/api/login/request', wrap(async (req, res) => {
  const s = await store.load();
  const u = user(s, req.body.userId); if (!u) fail('Unknown user');
  const code = issueOtp(u.id, 'login');
  // A real deployment sends this by SMS. In the demo the code is shown on screen.
  res.json({ simulatedSms: { to: u.mobile || u.email, code } });
}));

app.post('/api/login/verify', wrap(async (req, res) => {
  const s = await store.load();
  const u = user(s, req.body.userId); if (!u) fail('Unknown user');
  checkOtp(u.id, 'login', req.body.code);
  await store.audit(u.id, 'login', {});
  res.json({ token: sign(u.id) });
}));

app.get('/api/state', auth, wrap(async (req, res) => {
  const s = await store.load();
  const u = user(s, req.userId); if (!u) fail('Unknown user', 401);
  if (req.query.since && Number(req.query.since) === s.version) return res.json({ unchanged: true, version: s.version });
  res.json(viewFor(s, u));
}));

app.post('/api/otp', auth, wrap(async (req, res) => {
  const s = await store.load();
  const u = user(s, req.userId);
  const purpose = String(req.body.purpose || '');
  if (!/^(issue|sign):[\w-]+$/.test(purpose)) fail('Bad purpose');
  res.json({ simulatedSms: { to: u.mobile || u.email, code: issueOtp(u.id, purpose) } });
}));

app.post('/api/action', auth, wrap(async (req, res) => {
  const { type, payload } = req.body || {};
  const fn = actions[type]; if (!fn) fail('Unknown action');
  let u;
  const out = await withLock(() => store.mutate((s) => {
    u = user(s, req.userId); if (!u) fail('Unknown user', 401);
    const result = fn(s, u, payload || {}) || {};
    s.version += 1;
    return { ...result, version: s.version };
  }));
  if (!out.quiet) await store.audit(u.id, type, payload);
  res.json(out);
}));

// "Ask what the Board decided": a simple search over the resolution register and signed minutes.
app.post('/api/ask', auth, wrap(async (req, res) => {
  const s = await store.load();
  const u = user(s, req.userId);
  const v = viewFor(s, u);
  const q = String(req.body.q || '').toLowerCase();
  const stop = new Set(['what', 'did', 'the', 'board', 'decide', 'decided', 'about', 'on', 'a', 'an', 'of', 'for', 'to', 'in', 'was', 'we', 'is', 'when', 'which', 'who', 'how', 'much', 'and', 'any', 'our']);
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !stop.has(w));
  const scored = v.resolutions.map((r) => {
    const hay = `${r.title} ${r.text}`.toLowerCase();
    const score = words.reduce((a, w) => a + (hay.includes(w) ? 1 : 0) + (hay.includes(w.replace(/s$/, '')) ? 0.5 : 0), 0);
    return { r, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || b.r.passedOn.localeCompare(a.r.passedOn)).slice(0, 3);
  if (!words.length || !scored.length) return res.json({ answer: 'I could not find a resolution on that in the register. Try a keyword such as "dividend", "auditors" or "budget".', sources: [] });
  const top = scored[0].r;
  const m = s.meetings.find((x) => x.id === top.meetingId);
  const answer = `On ${fmtDate(top.passedOn)}, at the ${m ? m.title : 'meeting'}, it was resolved: ${top.text.replace(/^RESOLVED THAT /i, '')} (resolution ${top.ref}; ${top.tally.for} for, ${top.tally.against} against).`;
  res.json({ answer, sources: scored.map((x) => ({ ref: x.r.ref, title: x.r.title, passedOn: x.r.passedOn, meetingId: x.r.meetingId })) });
}));

app.post('/api/demo/reset', auth, wrap(async (req, res) => {
  await withLock(() => store.mutate((s) => {
    requireStaff(user(s, req.userId));
    const fresh = seed();
    fresh.version = s.version + 1;
    Object.keys(s).forEach((k) => delete s[k]);
    Object.assign(s, fresh);
  }));
  await store.audit(req.userId, 'demo.reset', {});
  res.json({ ok: true });
}));

app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

store.init().then(async () => {
  app.listen(PORT, () => console.log(`Boardroom 360 listening on ${PORT} (store: ${process.env.DATABASE_URL ? 'postgres' : 'memory'})`));
}).catch((e) => { console.error('Startup failed', e); process.exit(1); });
