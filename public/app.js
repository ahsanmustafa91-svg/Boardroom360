/* Boardroom 360 web client. Plain JavaScript, no build step. */
(function () {
  'use strict';

  // ---------------- utilities ----------------
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const fmtDate = (d, opts) => {
    if (!d) return 'Date to be confirmed';
    const dt = new Date(d.length === 10 ? d + 'T00:00:00Z' : d);
    return dt.toLocaleDateString('en-GB', Object.assign({ day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }, opts || {}));
  };
  const fmtDay = (d) => fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short', year: undefined });
  const fmtDT = (iso) => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const fmtTime = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
  const pkr = (n) => 'PKR ' + Number(n).toLocaleString('en-PK');
  const initials = (n) => String(n || '').replace(/^(Dr|Mr|Ms|Mrs)\.?\s+/i, '').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  const daysTo = (d) => d ? Math.round((new Date(d + 'T00:00:00Z') - new Date(S.today + 'T00:00:00Z')) / 86400000) : null;
  const ROLE = { chairman: 'Chairman', director: 'Director', ceo: 'CEO', cs: 'Company Secretary', csa: 'CS Assistant' };
  const REPLY = { in_person: 'Attending in person', video: 'Attending by video', apologies: 'Apologies (not attending)' };
  const OUTCOME = { passed: ['Passed', 'ok'], not_passed: ['Not passed', 'bad'], noted: ['Noted', ''], deferred: ['Deferred', 'warn'] };

  let token = store.get('b360.token');
  let S = null;
  let navOpen = false;
  let pending = false;

  // ---------------- API ----------------
  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) { signOut(); throw new Error(data.error || 'Please sign in again.'); }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  async function refresh(force) {
    if (!token) return;
    const data = await api('/api/state' + (S && !force ? '?since=' + S.version : ''));
    if (data.unchanged) return false;
    S = data; return true;
  }
  async function act(type, payload, okMsg) {
    try {
      const r = await api('/api/action', { type, payload });
      await refresh(true);
      if (okMsg) toast(okMsg);
      render();
      return r;
    } catch (e) { toast(e.message, true); throw e; }
  }
  function toast(msg, err) {
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), err ? 6000 : 3500);
  }

  // Live updates: poll for changes every 3 seconds.
  setInterval(async () => {
    if (!token || !S || pending || document.hidden) return;
    try {
      const changed = await refresh();
      if (changed) {
        const a = document.activeElement;
        const typing = a && /INPUT|TEXTAREA|SELECT/.test(a.tagName);
        if (!typing && !$('#modal-root').innerHTML) render();
      }
    } catch (e) { /* offline: try again next tick */ }
  }, 3000);

  // ---------------- lookups ----------------
  const me = () => S.me;
  const isStaff = () => me().role === 'cs' || me().role === 'csa';
  const user = (id) => S.users.find((u) => u.id === id) || { name: id, title: '' };
  const uname = (id) => user(id).name;
  const body = (id) => S.bodies.find((b) => b.id === id);
  const meeting = (id) => S.meetings.find((m) => m.id === id);
  const papersOf = (mid) => S.papers.filter((p) => p.meetingId === mid);
  const isMember = (m, uid) => body(m.body).members.includes(uid || me().id);
  const isChairOf = (m) => body(m.body).chair === me().id;
  const csId = () => (S.users.find((u) => u.role === 'cs') || {}).id;
  const noticesFor = (mid) => S.notices.filter((n) => n.meetingId === mid);
  const myInbox = () => S.notices.filter((n) => n.status === 'issued' && n.recipients[me().id]).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const statusChip = (m) => ({
    polling: '<span class="chip warn">Date poll open</span>',
    scheduled: '<span class="chip brand">Scheduled</span>',
    live: '<span class="chip live">Live now</span>',
    held: '<span class="chip">Held · minutes pending</span>',
    closed: '<span class="chip ok">Closed · minutes signed</span>',
  }[m.status]);
  const kindLabel = (k) => ({ original: 'Notice of meeting', postponement: 'Notice of postponement', venue: 'Notice of change of venue', supplementary: 'Supplementary agenda' }[k]);

  // ---------------- action items ----------------
  function actionItems() {
    const out = [];
    const u = me();
    const live = S.meetings.filter((m) => m.status === 'live' && (isMember(m) || isStaff()));
    live.forEach((m) => out.push({ icon: 'radio_button_checked', text: `${m.title} is live`, sub: 'Join to follow the agenda and vote', href: `#/live/${m.id}`, cta: 'Join now', urgent: true }));
    if (!isStaff()) {
      myInbox().filter((n) => !n.recipients[u.id].acknowledgedAt).forEach((n) => {
        const m = meeting(n.meetingId);
        out.push({ icon: 'mail', text: `${kindLabel(n.kind)}: ${m.title}`, sub: `Issued ${fmtDT(n.issuedAt)} · please acknowledge receipt`, href: `#/notice/${n.id}`, cta: 'Open notice' });
      });
      S.meetings.filter((m) => m.status === 'polling' && isMember(m)).forEach((m) => {
        const r = m.poll.responses[u.id] || {};
        if (Object.keys(r).length < m.poll.options.length) out.push({ icon: 'event', text: `Pick dates for the ${m.title}`, sub: `Poll closes ${fmtDate(m.poll.closesOn)}`, href: `#/meeting/${m.id}`, cta: 'Answer poll' });
      });
      S.meetings.filter((m) => m.status === 'scheduled' && isMember(m)).forEach((m) => {
        const unread = papersOf(m.id).filter((p) => !p.readBy[u.id]).length;
        if (!m.rsvps[u.id] && !myInbox().some((n) => n.meetingId === m.id && !n.recipients[u.id].acknowledgedAt)) out.push({ icon: 'how_to_reg', text: `Will you attend the ${m.title}?`, sub: `${fmtDate(m.date)} at ${fmtTime(m.time)}`, href: `#/meeting/${m.id}`, cta: 'Reply' });
        if (unread) out.push({ icon: 'description', text: `${unread} unread paper${unread > 1 ? 's' : ''} for the ${m.title}`, sub: `Meeting on ${fmtDate(m.date)}`, href: `#/pack/${m.id}`, cta: 'Read pack' });
      });
      S.meetings.filter((m) => m.status === 'polling' && isChairOf(m) && !m.agendaApproved).forEach((m) => out.push({ icon: 'fact_check', text: `Approve the agenda of the ${m.title}`, sub: 'Needed before the notice can be issued', href: `#/meeting/${m.id}`, cta: 'Review agenda' }));
      S.meetings.filter((m) => m.status === 'scheduled' && isChairOf(m) && !m.agendaApproved).forEach((m) => out.push({ icon: 'fact_check', text: `Approve the agenda of the ${m.title}`, sub: 'Needed before the notice can be issued', href: `#/meeting/${m.id}`, cta: 'Review agenda' }));
    }
    S.meetings.filter((m) => m.minutes && m.minutes.status === 'circulated' && (isChairOf(m) || u.role === 'cs') && !m.minutes.signatures[u.id]).forEach((m) => out.push({ icon: 'draw', text: `Sign the minutes of the ${m.title}`, sub: `Held ${fmtDate(m.date)}`, href: `#/minutes/${m.id}`, cta: 'Review and sign' }));
    if (isStaff()) {
      S.notices.filter((n) => n.status === 'draft').forEach((n) => out.push({ icon: 'mail', text: `${kindLabel(n.kind)} ${n.ref} is ready to issue`, sub: meeting(n.meetingId).title, href: `#/cs/notice/${n.id}`, cta: 'Open' }));
      S.meetings.filter((m) => m.status === 'polling').forEach((m) => {
        const n = Object.keys(m.poll.responses).length, of = body(m.body).members.length;
        out.push({ icon: 'event', text: `Date poll: ${m.title}`, sub: `${n} of ${of} replied · closes ${fmtDate(m.poll.closesOn)}`, href: `#/meeting/${m.id}`, cta: 'View poll' });
      });
      S.meetings.filter((m) => m.minutes && m.minutes.status === 'draft').forEach((m) => out.push({ icon: 'edit_note', text: `Finalise and circulate minutes of the ${m.title}`, sub: 'Drafted automatically from the meeting', href: `#/minutes/${m.id}`, cta: 'Open draft' }));
      S.notices.filter((n) => n.status === 'issued' && meeting(n.meetingId).status === 'scheduled').forEach((n) => {
        const notAck = Object.values(n.recipients).filter((r) => !r.acknowledgedAt).length;
        if (notAck) out.push({ icon: 'hourglass_top', text: `${notAck} not yet acknowledged ${n.ref}`, sub: meeting(n.meetingId).title, href: `#/cs/notice/${n.id}`, cta: 'Track' });
      });
    }
    return out;
  }

  // ---------------- views ----------------
  function signInView() {
    const step = store.get('b360.pending');
    let pendingUser = null;
    try { pendingUser = step ? JSON.parse(step) : null; } catch (e) { pendingUser = null; }
    return `
    <div class="signin">
      <section class="hero">
        <div class="logo"><div class="logo-mark">B360</div><div><span class="logo-text">Boardroom 360</span><small>The digital boardroom</small></div></div>
        <div class="hero-body">
          <h1>Your board, finally <em>in one place.</em></h1>
          <p>Notices, papers, votes, minutes and resolutions, with a record that stands up to SECP scrutiny. No more WhatsApp papers, phone-call attendance or minutes waiting weeks for a signature.</p>
          <ul class="hero-points">
            <li>${ms('mail')}<span>Notices and working papers, acknowledged on time</span></li>
            <li>${ms('cast_for_education')}<span>Live meetings with attendance, votes and suggestions</span></li>
            <li>${ms('history_edu')}<span>Minutes signed with a one-time code</span></li>
          </ul>
        </div>
      </section>
      <section class="panel" id="signin-panel">
        ${pendingUser ? otpPanel(pendingUser) : passwordPanel()}
      </section>
    </div>`;
  }
  let companyName = null;
  function passwordPanel() {
    if (companyName === null) {
      companyName = '';
      api('/api/company').then((d) => { companyName = d.company; render(); }).catch(() => {});
    }
    return `
      <h1>Sign in</h1>
      <p class="muted">${esc(companyName || 'Your company')} board portal. Sign in with the user ID and password the Company Secretary gave you.</p>
      <form onsubmit="event.preventDefault(); B.passwordLogin(this)" style="margin-top:8px">
        <label for="li-user">User ID</label><input id="li-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus>
        <label for="li-pass">Password</label><input id="li-pass" name="password" type="password" autocomplete="current-password" required>
        <button class="btn primary big" style="width:100%;margin-top:18px">Continue</button>
      </form>
      <p class="faint" style="margin-top:16px">After your password we send a one-time code to your registered mobile. Forgotten your password? Ask the Company Secretary to reset it.</p>
      <p class="faint">Demo mode: SMS codes are shown on screen instead of being sent.</p>`;
  }
  function otpPanel(p) {
    return `
      <h1>Enter your code</h1>
      <p class="muted">${p.name ? `Welcome, ${esc(p.name)}. ` : ''}We sent a 6-digit code to ${esc(p.to)}.</p>
      <div class="sms"><small>Simulated SMS · Boardroom 360</small>Your Boardroom 360 sign-in code is <b>${esc(p.code)}</b>. It expires in 5 minutes.</div>
      <form onsubmit="event.preventDefault(); B.verifyLogin()">
        <input id="otp" class="otp-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="••••••" autofocus>
        <div class="btns" style="margin-top:14px"><button class="btn primary big" type="submit" style="flex:1">Sign in</button><button class="btn big" type="button" onclick="B.cancelLogin()">Back</button></div>
      </form>`;
  }

  // Navigation items, shared by the top menu (desktop), rail (tablet) and bar + sheet (phone).
  function navItems() {
    const u = me();
    const items = actionItems();
    const staff = isStaff();
    const inboxUnack = staff ? 0 : myInbox().filter((n) => !n.recipients[u.id].acknowledgedAt).length;
    const draftCount = S.notices.filter((n) => n.status === 'draft').length;
    const liveCount = S.meetings.filter((m) => m.status === 'live' && (staff || isMember(m))).length;
    const settingsMatch = staff ? ['cs/settings', 'cs/users', 'cs/members', 'cs/activity', 'cs/compliance', 'password'] : ['settings', 'password'];
    return [
      { href: '#/home', label: 'Home', icon: 'home', count: items.length, primary: true },
      staff && { href: '#/cs/new', label: 'New Meeting', short: 'New', icon: 'add_circle' },
      staff ? { href: '#/cs/register', label: 'Notices', icon: 'mail', count: draftCount, primary: true, match: ['cs/notice'] }
        : { href: '#/notices', label: 'Notices', icon: 'mail', count: inboxUnack, primary: true, match: ['notice'] },
      { href: '#/papers', label: 'Working papers', short: 'Papers', icon: 'description', match: ['paper', 'pack'] },
      { href: '#/live', label: 'Live Meeting Room', short: 'Live', icon: 'cast_for_education', count: liveCount, primary: true, live: liveCount > 0 },
      { href: '#/minutes', label: 'Minutes of the Meetings', short: 'Minutes', icon: 'history_edu', primary: true, match: ['archive'] },
      { href: '#/resolutions', label: 'Resolutions', icon: 'gavel' },
      staff && { href: '#/cs/fees', label: 'Fees', icon: 'payments' },
      { href: '#/ask', label: 'Ask the record', short: 'Ask', icon: 'manage_search' },
      { sep: true },
      { href: staff ? '#/cs/settings' : '#/settings', label: 'Settings', icon: 'settings', match: settingsMatch },
    ].filter(Boolean);
  }
  const ms = (name, cls) => `<span class="ms ${cls || ''}" aria-hidden="true">${name}</span>`;

  function navActive(it, r) {
    const paths = [it.href.slice(2)].concat(it.match || []);
    return paths.some((p) => r === p || r.startsWith(p + '/'));
  }
  function shell(content, route) {
    const u = me();
    const nav = navItems();
    const isActive = (it) => navActive(it, route);
    const badge = (it) => (it.count ? `<span class="count">${it.count}</span>` : '');
    const cur = (it) => (isActive(it) ? 'aria-current="page"' : '');
    const drawer = nav.map((it) => it.sep ? '<span class="sep" aria-hidden="true"></span>'
      : `<a href="${it.href}" class="item ${isActive(it) ? 'active' : ''}" ${cur(it)}>${ms(it.icon, isActive(it) ? 'fill' : '')}<span class="label">${esc(it.label)}</span>${badge(it)}</a>`).join('');
    const railLink = (it) => `<a href="${it.href}" class="${isActive(it) ? 'active' : ''}" ${cur(it)}><span class="ind">${ms(it.icon)}${badge(it)}</span>${esc(it.short || it.label)}</a>`;
    const rail = nav.map((it) => (it.sep ? '<span class="sep" aria-hidden="true"></span>' : railLink(it))).join('');
    const primary = nav.filter((it) => it.primary);
    const rest = nav.filter((it) => !it.sep && !it.primary);
    const moreActive = rest.some(isActive);
    const moreCount = rest.reduce((a, it) => a + (it.count || 0), 0);
    const bar = primary.map(railLink).join('') + `<a href="javascript:void 0" role="button" onclick="B.openMore()" class="${moreActive ? 'active' : ''}"><span class="ind">${ms('menu')}${moreCount ? `<span class="count">${moreCount}</span>` : ''}</span>More</a>`;
    return `
      <nav class="drawer" aria-label="Main"><a class="logo" href="#/home"><div class="logo-mark">B360</div><div><span class="logo-text">Boardroom 360</span><small>${esc(S.company.name)}</small></div></a>${drawer}</nav>
      <aside class="rail" aria-label="Main"><a class="logo" href="#/home" aria-label="Home"><div class="logo-mark">B360</div></a>${rail}</aside>
      <div class="masthead">
      <header class="topbar">
        <a class="logo" href="#/home"><div class="logo-mark">B360</div><div><span class="logo-text">Boardroom 360</span><small>${esc(S.company.name)}</small></div></a>
        <div class="tb-title">${esc(S.company.name)}</div>
        <div class="spacer"></div>
        <div class="who"><b>${esc(u.name)}</b><span>${esc(u.title)}</span></div>
        <a class="icon-btn" href="#/password" title="Change password" aria-label="Change password">${ms('key')}</a>
        <button class="icon-btn" onclick="B.signOut()" title="Sign out" aria-label="Sign out">${ms('logout')}</button>
      </header>
      </div>
      <div class="shell">
        <main>${content}</main>
      </div>
      <nav class="navbar" aria-label="Main">${bar}</nav>`;
  }
  function moreSheet() {
    const r = route();
    const rest = navItems().filter((it) => !it.sep && !it.primary);
    $('#modal-root').innerHTML = `<div class="sheet-back" onclick="if(event.target===this)B.closeSheet()"><div class="sheet" role="dialog" aria-label="More"><div class="handle"></div>
      ${rest.map((it) => { const a = navActive(it, r); return `<a href="${it.href}" class="${a ? 'active' : ''}" onclick="B.closeSheet()">${ms(it.icon, a ? 'fill' : '')}${esc(it.label)}${it.count ? `<span class="count">${it.count}</span>` : ''}</a>`; }).join('')}
      <a href="#/password" onclick="B.closeSheet()">${ms('key')}Change password</a>
      <a href="javascript:void 0" onclick="B.closeSheet(); B.signOut()">${ms('logout')}Sign out</a>
    </div></div>`;
  }

  function homeView() {
    const u = me();
    const items = actionItems();
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const upcoming = S.meetings.filter((m) => ['scheduled', 'live', 'polling'].includes(m.status)).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
    const first = u.name.replace(/^(Dr|Mr|Ms|Mrs)\.?\s+/i, '').split(' ')[0];
    return `
      <div class="page-head"><div><h1>${greet}, ${esc(first)}</h1><p class="muted">${items.length ? `You have ${items.length} thing${items.length > 1 ? 's' : ''} to do.` : 'You are all caught up.'}</p></div></div>
      ${isStaff() ? csStats() : ''}
      <div class="card flush">
        <div class="card-head" style="padding:16px 24px 0"><h2>Your actions</h2></div>
        ${items.length ? `<ul class="list">${items.map((a) => `
          <li class="row action-row" onclick="location.hash='${a.href}'">
            <div class="icon-dot ${a.urgent ? 'urgent' : ''}">${ms(a.icon)}</div>
            <div class="grow"><div class="title">${esc(a.text)}</div><div class="faint">${esc(a.sub)}</div></div>
            <a class="btn small hide-sm ${a.urgent ? 'primary' : ''}" href="${a.href}">${a.cta}</a>
          </li>`).join('')}</ul>` : '<div class="empty">Nothing needs you right now.</div>'}
      </div>
      <div class="card flush">
        <div class="card-head" style="padding:16px 24px 0"><h2>Coming up</h2><a href="#/meetings" class="faint">All meetings</a></div>
        <ul class="list">${upcoming.map(meetingRow).join('') || '<div class="empty">No upcoming meetings.</div>'}</ul>
      </div>`;
  }
  function csStats() {
    const drafts = S.notices.filter((n) => n.status === 'draft').length;
    const pendingComp = S.compliance.filter((c) => c.status !== 'filed').length;
    const feesDue = Object.values(S.fees).reduce((a, f) => a + Object.values(f).filter((x) => x === 'due').length, 0);
    const upcoming = S.meetings.filter((m) => ['scheduled', 'polling', 'live'].includes(m.status)).length;
    return `<div class="grid4">
      <a class="card stat" href="#/meetings" style="color:inherit"><div class="n">${upcoming}</div><div class="l">Upcoming meetings</div></a>
      <a class="card stat" href="#/cs/register" style="color:inherit"><div class="n">${drafts}</div><div class="l">Notices to issue</div></a>
      <a class="card stat" href="#/cs/compliance" style="color:inherit"><div class="n">${pendingComp}</div><div class="l">Filings pending</div></a>
      <a class="card stat" href="#/cs/fees" style="color:inherit"><div class="n">${feesDue}</div><div class="l">Meeting fees due</div></a>
    </div>`;
  }
  function meetingRow(m) {
    const b = body(m.body);
    const when = m.status === 'polling' ? `Date poll: ${m.poll.options.map((d) => fmtDay(d)).join(', ')}` : `${fmtDate(m.date)}${m.time ? ' · ' + fmtTime(m.time) : ''}`;
    return `<li class="row action-row" onclick="location.hash='#/meeting/${m.id}'">
      <div class="icon-dot">${b.code}</div>
      <div class="grow"><div class="title">${esc(m.title)}</div><div class="faint">${esc(when)}</div></div>
      ${statusChip(m)}
    </li>`;
  }

  function meetingsView(tab) {
    tab = tab || 'upcoming';
    const list = S.meetings.filter((m) => tab === 'upcoming' ? ['polling', 'scheduled', 'live'].includes(m.status) : ['held', 'closed'].includes(m.status))
      .sort((a, b) => tab === 'upcoming' ? (a.date || '9999').localeCompare(b.date || '9999') : (b.date || '').localeCompare(a.date || ''));
    return `
      <div class="page-head"><div><h1>Meetings</h1><p class="muted">Board and committee meetings you belong to.</p></div>${isStaff() ? '<a class="btn primary" href="#/cs/new">New meeting</a>' : ''}</div>
      <div class="tabs"><a href="#/meetings/upcoming" class="${tab === 'upcoming' ? 'active' : ''}">Upcoming</a><a href="#/meetings/past" class="${tab === 'past' ? 'active' : ''}">Past</a></div>
      <div class="card flush"><ul class="list">${list.map(meetingRow).join('') || '<div class="empty">None.</div>'}</ul></div>`;
  }

  function meetingView(id) {
    const m = meeting(id);
    if (!m) return notFound();
    const b = body(m.body);
    const u = me();
    const papers = papersOf(m.id);
    const ns = noticesFor(m.id);
    const myNotice = ns.filter((n) => n.status === 'issued' && n.recipients[u.id]).pop();
    let html = `
      <div class="page-head"><div><div class="faint">${esc(b.name)}</div><h1>${esc(m.title)}</h1><div class="btns">${statusChip(m)}${m.agendaApproved ? `<span class="chip ok">Agenda approved by ${esc(uname(b.chair))}</span>` : `<span class="chip warn">Agenda awaiting approval by ${esc(uname(b.chair))} (Chair)</span>`}</div></div>
      <div class="btns">${m.status === 'live' ? `<a class="btn primary" href="#/live/${m.id}">Join live meeting</a>` : ''}
        ${m.status === 'scheduled' && isStaff() ? `<button class="btn primary" onclick="B.startMeeting('${m.id}')">Start meeting</button>` : ''}
        ${m.minutes ? `<a class="btn" href="#/minutes/${m.id}">Minutes</a>` : ''}
        ${papers.length ? `<a class="btn" href="#/pack/${m.id}">Read entire pack</a>` : ''}</div></div>`;
    if (m.status === 'live') html += `<div class="banner live"><span>This meeting is in progress.</span><a class="btn small" href="#/live/${m.id}">Join now</a></div>`;
    html += `<div class="grid2 top"><div>`;
    // details
    html += `<div class="card"><h2>Details</h2><dl class="kv">
      <dt>Date</dt><dd>${m.date ? fmtDate(m.date, { weekday: 'long' }) : 'To be confirmed by date poll'}</dd>
      <dt>Time</dt><dd>${fmtTime(m.time)}</dd>
      <dt>Venue</dt><dd>${esc(m.venue)}</dd>
      <dt>Video link</dt><dd>${m.videoLink ? `<a href="${esc(m.videoLink)}" target="_blank" rel="noopener">Join by video</a>` : '—'}</dd>
      <dt>Chair</dt><dd>${esc(uname(b.chair))}</dd>
      <dt>Quorum</dt><dd>${m.quorum} members</dd>
    </dl>
    ${m.date && m.status === 'scheduled' ? `<div class="btns" style="margin-top:14px"><button class="btn small" onclick="B.ics('${m.id}')">Add to calendar</button></div>` : ''}</div>`;
    // poll
    if (m.status === 'polling') html += pollCard(m);
    // RSVP
    if (m.status === 'scheduled' && isMember(m) && !isStaff()) {
      html += `<div class="card"><h2>Will you attend?</h2><div class="btns">${Object.entries(REPLY).map(([k, v]) => `<button class="btn ${m.rsvps[u.id] === k ? 'sel' : ''}" onclick="B.rsvp('${m.id}','${k}')">${v.replace(' (not attending)', '')}</button>`).join('')}</div></div>`;
    }
    if (isStaff() || isChairOf(m)) html += attendanceCard(m);
    html += `</div><div>`;
    // agenda
    html += `<div class="card"><div class="card-head"><h2>Agenda</h2>${isChairOf(m) && !m.agendaApproved && ['polling', 'scheduled'].includes(m.status) ? `<button class="btn primary small" onclick="B.act('agenda.approve',{meetingId:'${m.id}'},'Agenda approved')">Approve agenda</button>` : ''}</div>
      ${agendaApprovalNote(m)}
      <ol class="list">${m.agenda.map((it) => {
        const p = papers.find((x) => x.itemId === it.id);
        return `<li style="padding:12px 0;border-top:1px solid var(--line);display:flex;gap:12px;align-items:flex-start">
          <b style="width:22px">${it.no}.</b>
          <div style="flex:1"><div>${esc(it.title)}</div>
            <div class="faint">${it.type === 'decision' ? 'For decision' : 'For information'} · ${esc(uname(it.presenter))}${it.outcome ? ` · <span class="chip ${OUTCOME[it.outcome][1]}">${OUTCOME[it.outcome][0]}</span>` : ''}</div>
            ${p ? `<a href="#/paper/${p.id}" class="faint" style="display:inline-flex;align-items:center;gap:4px;min-height:32px">${ms('description', 'sm')} ${esc(p.title)}${p.readBy[u.id] ? ' · read' : ''}</a>` : ''}
          </div>
          ${isStaff() && ['polling', 'scheduled'].includes(m.status) ? `<button class="icon-btn" title="Remove item" aria-label="Remove item" onclick="B.removeItem('${m.id}','${it.id}')">${ms('delete')}</button>` : ''}
        </li>`;
      }).join('')}</ol>
      ${isStaff() && ['polling', 'scheduled'].includes(m.status) ? addItemForm(m) : ''}
    </div>`;
    // notices
    if (isStaff() && ns.length) {
      html += `<div class="card"><h2>Notices</h2><ul class="list">${ns.map((n) => `<li class="row" style="padding:10px 0"><div class="grow"><a class="title" href="#/cs/notice/${n.id}">${esc(n.ref)}</a><div class="faint">${kindLabel(n.kind)}</div></div>${n.status === 'issued' ? '<span class="chip ok">Issued</span>' : '<span class="chip warn">Draft</span>'}</li>`).join('')}</ul>
        ${m.status === 'scheduled' && ns.some((n) => n.status === 'issued') ? `<div class="btns" style="margin-top:12px"><button class="btn small" onclick="B.changeNotice('${m.id}','postponement')">Postpone</button><button class="btn small" onclick="B.changeNotice('${m.id}','venue')">Change venue</button><button class="btn small" onclick="B.changeNotice('${m.id}','supplementary')">Supplementary agenda</button></div>` : ''}
        ${m.status === 'scheduled' && !ns.some((n) => n.status === 'draft') && !ns.some((n) => n.status === 'issued') ? `<button class="btn small" onclick="B.draftNotice('${m.id}')">Draft notice</button>` : ''}
      </div>`;
    } else if (isStaff() && m.status === 'scheduled') {
      html += `<div class="card"><h2>Notices</h2><button class="btn primary" onclick="B.draftNotice('${m.id}')">Draft notice</button></div>`;
    } else if (myNotice) {
      html += `<div class="card"><h2>Notice</h2><a href="#/notice/${myNotice.id}">${esc(myNotice.ref)} · ${kindLabel(myNotice.kind)}</a></div>`;
    }
    html += `</div></div>`;
    return html;
  }

  function agendaApprovalNote(m) {
    if (!['polling', 'scheduled'].includes(m.status)) return '';
    const chair = uname(body(m.body).chair);
    if (m.agendaApproved) return `<p class="faint" style="display:flex;align-items:center;gap:4px">${ms('check_circle', 'sm')} Approved by ${esc(chair)} (Chair)${m.agendaApprovedAt ? ' on ' + fmtDT(m.agendaApprovedAt) : ''}.</p>`;
    if (isChairOf(m)) return '<p class="faint">As Chair, your approval is needed before the Company Secretary can issue the notice.</p>';
    return `<p class="note-warn">Only the Chair of this ${m.body === 'board' ? 'Board' : 'committee'}, ${esc(chair)}, can approve the agenda. The notice cannot be issued until they do.</p>`;
  }

  function pollCard(m) {
    const b = body(m.body);
    const u = me();
    const mine = m.poll.responses[u.id] || {};
    const score = (d) => b.members.reduce((a, id) => a + ((m.poll.responses[id] || {})[d] === 'yes' ? 1 : 0), 0);
    const best = m.poll.options.slice().sort((a, c) => score(c) - score(a))[0];
    let h = `<div class="card"><div class="card-head"><h2>Date poll</h2><span class="faint">Closes ${fmtDate(m.poll.closesOn)}</span></div>`;
    if (isMember(m) && !isStaff()) {
      h += `<p class="muted">Which dates work for you?</p>`;
      h += m.poll.options.map((d) => `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--line);flex-wrap:wrap"><div style="flex:1"><b>${fmtDate(d, { weekday: 'long' })}</b></div>
        ${['yes', 'maybe', 'no'].map((a) => `<button class="btn small ${mine[d] === a ? 'sel' : ''}" onclick="B.act('poll.respond',{meetingId:'${m.id}',date:'${d}',answer:'${a}'})">${a[0].toUpperCase() + a.slice(1)}</button>`).join('')}</div>`).join('');
    }
    if (isStaff() || isChairOf(m)) {
      h += `<div class="table-wrap" style="margin-top:12px"><table class="poll-grid"><tr><th>Member</th>${m.poll.options.map((d) => `<th>${fmtDay(d)}</th>`).join('')}</tr>
        ${b.members.map((id) => `<tr><td>${esc(uname(id))}</td>${m.poll.options.map((d) => { const a = (m.poll.responses[id] || {})[d]; return `<td>${a ? `<span class="yn ${a}">${ms(a === 'yes' ? 'check' : a === 'no' ? 'close' : 'help')}</span>` : '<span class="faint">—</span>'}</td>`; }).join('')}</tr>`).join('')}
        <tr><td><b>Available</b></td>${m.poll.options.map((d) => `<td><b>${score(d)}</b></td>`).join('')}</tr></table></div>`;
    }
    if (isStaff()) {
      h += `<label>Confirm the date and close the poll</label><div class="btns"><select id="pollDate" style="flex:1">${m.poll.options.map((d) => `<option value="${d}" ${d === best ? 'selected' : ''}>${fmtDate(d, { weekday: 'long' })} (${score(d)} available)</option>`).join('')}</select>
        <button class="btn primary" onclick="B.closePoll('${m.id}')">Confirm date</button></div><p class="faint" style="margin-top:6px">The notice is then drafted automatically on the letterhead.</p>`;
    }
    return h + '</div>';
  }

  function attendanceCard(m) {
    const b = body(m.body);
    const src = ['live', 'held', 'closed'].includes(m.status) ? m.attendance : null;
    return `<div class="card"><h2>${src ? 'Attendance' : 'Replies'}</h2><ul class="list">${b.members.map((id) => {
      const v = src ? src[id] : m.rsvps[id];
      const label = src ? ({ present: ['Present', 'ok'], virtual: ['By video', 'ok'], apologies: ['Apologies', 'warn'], absent: ['Absent', 'bad'] }[v] || ['—', '']) : (v ? [REPLY[v].split(' (')[0], v === 'apologies' ? 'warn' : 'ok'] : ['No reply yet', '']);
      return `<li class="row" style="padding:8px 0"><span class="avatar">${initials(uname(id))}</span><div class="grow">${esc(uname(id))}<div class="faint">${esc(user(id).title)}</div></div><span class="chip ${label[1]}">${label[0]}</span></li>`;
    }).join('')}</ul></div>`;
  }

  function addItemForm(m) {
    return `<details style="margin-top:12px"><summary class="btn small">Add agenda item</summary>
      <form onsubmit="event.preventDefault(); B.addItem('${m.id}', this)" style="margin-top:8px">
        <label>Title</label><input name="title" required>
        <div class="grid2"><div><label>Type</label><select name="type"><option value="info">For information</option><option value="decision">For decision</option></select></div>
        <div><label>Presenter</label><select name="presenter">${S.users.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div></div>
        <label>Proposed resolution (for decision items)</label><textarea name="resolutionText" placeholder="RESOLVED THAT …"></textarea>
        <label>Board paper (optional; separate pages with a blank line)</label><textarea name="paperBody"></textarea>
        <button class="btn primary" style="margin-top:10px">Add item</button>
      </form></details>`;
  }

  // ---- notices (directors) ----
  function noticesView() {
    const list = myInbox();
    return `<div class="page-head"><div><h1>Notices</h1><p class="muted">Formal notices of meetings addressed to you. Every notice is sealed and kept permanently.</p></div></div>
      <div class="card flush"><ul class="list">${list.map((n) => {
        const r = n.recipients[me().id];
        const m = meeting(n.meetingId);
        return `<li class="row action-row" onclick="location.hash='#/notice/${n.id}'"><div class="icon-dot">${ms('mail')}</div>
          <div class="grow"><div class="title">${kindLabel(n.kind)}: ${esc(m.title)}</div><div class="faint">${esc(n.ref)} · issued ${fmtDT(n.issuedAt)}</div></div>
          ${r.acknowledgedAt ? '<span class="chip ok">Acknowledged</span>' : '<span class="chip warn">Please acknowledge</span>'}</li>`;
      }).join('') || '<div class="empty">No notices yet.</div>'}</ul></div>`;
  }

  function letter(n) {
    const m = meeting(n.meetingId);
    const b = body(m.body);
    const orig = n.linkedTo ? S.notices.find((x) => x.id === n.linkedTo) : null;
    const intro = {
      original: `NOTICE is hereby given that the ${esc(m.title)} of ${esc(S.company.name)} will be held on <b>${fmtDate(m.date, { weekday: 'long' })}</b> at <b>${fmtTime(m.time)}</b> at ${esc(m.venue)}${m.videoLink ? ', with participation by video link also available' : ''}, to transact the following business:`,
      postponement: `Further to notice ${esc(orig ? orig.ref : '')}, NOTICE is hereby given that the ${esc(m.title)} has been postponed and will now be held on <b>${fmtDate(n.newDate || m.date, { weekday: 'long' })}</b> at <b>${fmtTime(m.time)}</b> at ${esc(m.venue)}.`,
      venue: `Further to notice ${esc(orig ? orig.ref : '')}, NOTICE is hereby given that the venue of the ${esc(m.title)} on ${fmtDate(m.date)} has changed to <b>${esc(n.newVenue || m.venue)}</b>.`,
      supplementary: `Further to notice ${esc(orig ? orig.ref : '')}, NOTICE is hereby given that the following supplementary business will also be transacted at the ${esc(m.title)} on ${fmtDate(m.date)}:`,
    }[n.kind];
    return `<div class="letter">
      <div class="lh"><div><b>${esc(S.company.name)}</b><div class="faint">${esc(S.company.address)} · Registration No. ${esc(S.company.regNo)}</div></div><div style="text-align:right"><div class="faint">Ref: ${esc(n.ref)}</div><div class="faint">${fmtDate((n.issuedAt || new Date().toISOString()).slice(0, 10))}</div></div></div>
      <h3>${kindLabel(n.kind)}</h3>
      <p>To: the members of the ${esc(b.name)}</p>
      <p>${intro}</p>
      ${['original', 'supplementary'].includes(n.kind) ? `<ol>${m.agenda.map((it) => `<li>${esc(it.title)}${it.type === 'decision' ? ' <i>(for decision)</i>' : ''}</li>`).join('')}</ol>` : ''}
      ${m.videoLink && n.kind !== 'venue' ? `<p>Video link: <a href="${esc(m.videoLink)}" target="_blank" rel="noopener">${esc(m.videoLink)}</a></p>` : ''}
      ${n.note ? `<p>${esc(n.note)}</p>` : ''}
      <p>Board papers are available in Boardroom 360. Please acknowledge receipt and confirm your attendance.</p>
      <p style="margin-top:28px">By order of the ${b.id === 'board' ? 'Board' : 'Committee'}</p>
      <p><b>${esc(uname(csId()))}</b><br>Company Secretary</p>
      ${n.status === 'issued' ? `<span class="seal">${ms('verified', 'sm')} Signed and issued ${fmtDT(n.issuedAt)} · sealed</span>` : '<span class="chip warn">Draft, not yet issued</span>'}
    </div>`;
  }

  function noticeView(id) {
    const n = S.notices.find((x) => x.id === id);
    if (!n) return notFound();
    const r = n.recipients[me().id];
    if (r && !r.openedAt) setTimeout(() => api('/api/action', { type: 'notice.open', payload: { noticeId: id } }).catch(() => {}), 0);
    const m = meeting(n.meetingId);
    return `<div class="page-head"><div><a href="#/notices" class="faint" style="display:inline-flex;align-items:center;gap:4px;min-height:32px">${ms('arrow_back', 'sm')} Notices</a><h1>${kindLabel(n.kind)}</h1></div></div>
      <div class="split">
        <div>${letter(n)}</div>
        <div>${r ? `<div class="card"><h2>Your reply</h2>
          ${r.acknowledgedAt ? `<p><span class="chip ok">Receipt acknowledged ${fmtDT(r.acknowledgedAt)}</span></p>` : '<p class="muted">Please acknowledge receipt of this notice.</p>'}
          <label>Attendance</label>
          <div style="display:grid;gap:8px">${Object.entries(REPLY).map(([k, v]) => `<button class="btn ${r.reply === k ? 'sel' : ''}" onclick="B.ack('${n.id}','${k}')">${v}</button>`).join('')}</div>
          ${!r.acknowledgedAt ? `<button class="btn primary" style="margin-top:12px;width:100%" onclick="B.ack('${n.id}')">Acknowledge receipt</button>` : ''}
          <hr class="divider">
          <div class="btns"><button class="btn small" onclick="B.ics('${m.id}')">Add to calendar</button><a class="btn small" href="#/meeting/${m.id}">Meeting and papers</a></div>
        </div>` : ''}</div>
      </div>`;
  }

  // ---- CS: notice screen (compose, issue, track) ----
  function csNoticeView(id) {
    const n = S.notices.find((x) => x.id === id);
    if (!n) return notFound();
    const m = meeting(n.meetingId);
    let side;
    if (n.status === 'draft') {
      const ok = n.checks.every((c) => c.ok);
      side = `<div class="card"><h2>Before it can be sent</h2>${n.checks.map((c) => `<div class="check ${c.ok ? 'ok' : 'bad'}"><span class="mark">${ms(c.ok ? 'check' : 'priority_high')}</span><div>${esc(c.label)}${!c.ok && c.id === 'contacts' ? (me().role === 'cs' ? ' · <a href="#/cs/users">Fix in Users</a>' : ' · <a href="#/cs/members">Fix in Members</a>') : ''}</div></div>`).join('')}
        <label>Additional note on the notice (optional)</label><textarea id="noticeNote">${esc(n.note)}</textarea>
        <button class="btn small" style="margin-top:8px" onclick="B.saveNote('${n.id}')">Save note</button>
        <hr class="divider">
        ${me().role === 'cs' ? `<button class="btn primary big" style="width:100%" ${ok ? '' : 'disabled'} onclick="B.issueNotice('${n.id}')">Sign and issue</button><p class="faint" style="margin-top:8px">Sent by email and SMS to ${body(m.body).members.length} recipients. You confirm with a one-time code.</p>` : '<p class="faint">Only the Company Secretary can sign and issue a notice.</p>'}
      </div>`;
    } else {
      const rs = Object.entries(n.recipients);
      const opened = rs.filter(([, r]) => r.openedAt).length, acked = rs.filter(([, r]) => r.acknowledgedAt).length;
      side = `<div class="card"><h2>Delivery</h2>
        <div class="grid3" style="gap:8px;margin-bottom:12px"><div><div class="stat n" style="padding:0">${rs.length}</div><div class="faint">Delivered</div></div><div><div class="stat n" style="padding:0">${opened}</div><div class="faint">Opened</div></div><div><div class="stat n" style="padding:0">${acked}</div><div class="faint">Acknowledged</div></div></div>
        <ul class="list">${rs.map(([uid, r]) => `<li class="row" style="padding:10px 0"><div class="grow"><b>${esc(uname(uid))}</b><div class="faint">${r.acknowledgedAt ? `Acknowledged ${fmtDT(r.acknowledgedAt)}${r.reply ? ' · ' + REPLY[r.reply] : ''}` : r.openedAt ? `Opened ${fmtDT(r.openedAt)}` : `Delivered ${fmtDT(r.deliveredAt)}`}${r.reminders ? ` · ${r.reminders} reminder${r.reminders > 1 ? 's' : ''}` : ''}</div></div>
          ${r.acknowledgedAt ? '<span class="chip ok">Acknowledged</span>' : `<button class="btn small" onclick="B.act('notice.remind',{noticeId:'${n.id}',userId:'${uid}'},'Reminder sent by SMS and email')">Remind</button>`}</li>`).join('')}</ul></div>`;
    }
    return `<div class="page-head"><div><a href="#/cs/register" class="faint" style="display:inline-flex;align-items:center;gap:4px;min-height:32px">${ms('arrow_back', 'sm')} Notice register</a><h1>${esc(n.ref)}</h1><div class="btns"><span class="chip">${kindLabel(n.kind)}</span>${n.status === 'issued' ? '<span class="chip ok">Issued · sealed</span>' : '<span class="chip warn">Draft</span>'}</div></div><a class="btn" href="#/meeting/${m.id}">Meeting</a></div>
      <div class="split"><div>${letter(n)}</div><div>${side}</div></div>`;
  }

  function csRegisterView() {
    const list = S.notices.slice().sort((a, b) => (b.issuedAt || b.createdAt).localeCompare(a.issuedAt || a.createdAt));
    return `<div class="page-head"><div><h1>Notice register</h1><p class="muted">Every notice for every body, including postponements and supplementary agendas. Issued notices are sealed and kept permanently.</p></div></div>
      <div class="card flush table-wrap"><table><tr><th>Reference</th><th>Meeting</th><th>Type</th><th class="hide-sm">Issued</th><th>Acknowledged</th></tr>
      ${list.map((n) => { const rs = Object.values(n.recipients); return `<tr class="action-row" onclick="location.hash='#/cs/notice/${n.id}'"><td><a href="#/cs/notice/${n.id}"><b>${esc(n.ref)}</b></a>${n.linkedTo ? `<div class="faint">Linked to ${esc((S.notices.find((x) => x.id === n.linkedTo) || {}).ref)}</div>` : ''}</td><td>${esc(meeting(n.meetingId).title)}</td><td>${kindLabel(n.kind)}</td><td class="hide-sm">${n.issuedAt ? fmtDT(n.issuedAt) : '<span class="chip warn">Draft</span>'}</td><td>${n.status === 'issued' ? `${rs.filter((r) => r.acknowledgedAt).length} / ${rs.length}` : '—'}</td></tr>`; }).join('')}
      </table></div>`;
  }

  // ---- papers ----
  function paperView(id) {
    const p = S.papers.find((x) => x.id === id);
    if (!p) return notFound();
    if (!p.readBy[me().id]) setTimeout(() => api('/api/action', { type: 'paper.read', payload: { paperId: id } }).catch(() => {}), 1500);
    const m = meeting(p.meetingId);
    const it = m.agenda.find((x) => x.id === p.itemId);
    return `<div class="reader">
      <div class="page-head"><div><a href="#/meeting/${m.id}" class="faint" style="display:inline-flex;align-items:center;gap:4px;min-height:32px">${ms('arrow_back', 'sm')} ${esc(m.title)}</a><h1>${esc(p.title)}</h1><p class="faint">Agenda item ${it ? it.no : ''} · ${p.pages.length} page${p.pages.length > 1 ? 's' : ''}</p></div><a class="btn" href="#/pack/${m.id}">Read entire pack</a></div>
      ${p.pages.map((t, i) => `<div class="page"><div class="pno">Page ${i + 1} of ${p.pages.length}</div>${esc(t)}</div>`).join('')}
      ${it && it.resolutionText ? `<div class="card"><h3>Proposed resolution</h3><p class="muted">${esc(it.resolutionText)}</p></div>` : ''}
      ${notesBox(p.id)}
    </div>`;
  }
  function notesBox(pid) {
    return `<div class="card"><h3>My private notes</h3><p class="faint">Only you can see these.</p><textarea id="note-${pid}" onblur="B.saveNotes('${pid}')" placeholder="Write a note…">${esc(S.notes[pid] || '')}</textarea></div>`;
  }
  function packView(mid) {
    const m = meeting(mid);
    if (!m) return notFound();
    const ps = papersOf(mid);
    ps.forEach((p) => { if (!p.readBy[me().id]) setTimeout(() => api('/api/action', { type: 'paper.read', payload: { paperId: p.id } }).catch(() => {}), 2000); });
    return `<div class="reader">
      <div class="page-head"><div><a href="#/meeting/${m.id}" class="faint" style="display:inline-flex;align-items:center;gap:4px;min-height:32px">${ms('arrow_back', 'sm')} ${esc(m.title)}</a><h1>Board pack</h1><p class="faint">${ps.length} papers · ${ps.reduce((a, p) => a + p.pages.length, 0)} pages, in agenda order</p></div></div>
      ${m.agenda.map((it) => {
        const p = ps.find((x) => x.itemId === it.id);
        return `<h2 style="margin:24px 0 10px">${it.no}. ${esc(it.title)}</h2>${p ? p.pages.map((t, i) => `<div class="page"><div class="pno">${esc(p.title)} · page ${i + 1}</div>${esc(t)}</div>`).join('') + notesBox(p.id) : '<p class="faint">No paper for this item.</p>'}`;
      }).join('')}
    </div>`;
  }

  // ---- working papers ----
  function papersView() {
    const u = me();
    const ms_ = S.meetings.filter((m) => papersOf(m.id).length && ['scheduled', 'live', 'polling', 'held'].includes(m.status))
      .sort((a, b) => (a.status === 'live' ? -1 : 0) - (b.status === 'live' ? -1 : 0) || (a.date || '9999').localeCompare(b.date || '9999'));
    const block = (m) => {
      const ps = papersOf(m.id);
      const unread = ps.filter((p) => !p.readBy[u.id]).length;
      return `<div class="card flush"><div class="card-head" style="padding:16px 24px 8px"><div><h2 style="margin:0">${esc(m.title)}</h2><div class="faint">${m.date ? fmtDate(m.date) : 'Date to be fixed'} · ${ps.length} paper${ps.length > 1 ? 's' : ''}${!isStaff() && unread ? ` · ${unread} unread` : ''}</div></div><a class="btn small" href="#/pack/${m.id}">Read entire pack</a></div>
        <ul class="list">${ps.map((p) => { const it = m.agenda.find((x) => x.id === p.itemId); const read = Object.keys(p.readBy).length; return `<li class="row action-row" onclick="location.hash='#/paper/${p.id}'"><div class="icon-dot">${ms('description')}</div>
          <div class="grow"><div class="title">${esc(p.title)}</div><div class="faint">Item ${it ? it.no : '—'} · ${p.pages.length} page${p.pages.length > 1 ? 's' : ''}${isStaff() ? ` · read by ${read}` : ''}</div></div>
          ${isStaff() ? '' : p.readBy[u.id] ? '<span class="chip ok">Read</span>' : '<span class="chip warn">Unread</span>'}</li>`; }).join('')}</ul></div>`;
    };
    return `<div class="page-head"><div><h1>Working papers</h1><p class="muted">Papers for upcoming and recent meetings, in agenda order. Past meetings' papers stay in Minutes of the Meetings.</p></div></div>
      ${ms_.map(block).join('') || '<div class="card empty">No working papers yet.</div>'}`;
  }

  // ---- live meeting room (lobby) ----
  function liveRoomView() {
    const staff = isStaff();
    const live = S.meetings.filter((m) => m.status === 'live' && (staff || isMember(m)));
    const next = S.meetings.filter((m) => m.status === 'scheduled' && (staff || isMember(m))).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const liveCard = (m) => {
      const present = Object.values(m.attendance).filter((x) => x === 'present' || x === 'virtual').length;
      const it = m.agenda[m.liveItem] || m.agenda[0];
      return `<div class="card live-lobby"><div class="card-head"><div><span class="chip bad" style="gap:4px">${ms('radio_button_checked', 'sm fill')} Live now</span><h2 style="margin:12px 0 4px">${esc(m.title)}</h2>
        <div class="faint">${present} of ${body(m.body).members.length} in the room · quorum ${m.quorum} · now on item ${it.no}: ${esc(it.title)}</div></div>
        <a class="btn primary" href="#/live/${m.id}">${ms('login')}${staff ? 'Open the room' : 'Join the meeting'}</a></div></div>`;
    };
    return `<div class="page-head"><div><h1>Live Meeting Room</h1><p class="muted">Join a meeting in progress. Attendance is marked when you join, the agenda is approved live, and every agenda item has a suggestions panel.</p></div></div>
      ${live.map(liveCard).join('') || `<div class="card empty"><span class="ms" style="font-size:40px;color:var(--md-on-surface-variant)">event_available</span><h2>No meeting is live right now</h2><p class="muted">${staff ? 'Start a scheduled meeting below and members can join from here.' : 'When the Company Secretary starts a meeting, it appears here.'}</p></div>`}
      ${next.length ? `<h2 style="margin:24px 0 12px">Scheduled</h2><div class="card flush"><ul class="list">${next.map((m) => `<li class="row"><div class="icon-dot">${esc(body(m.body).code)}</div><div class="grow"><div class="title">${esc(m.title)}</div><div class="faint">${fmtDate(m.date)}${m.time ? ' · ' + fmtTime(m.time) : ''} · ${esc(m.venue || '')}</div></div>
        ${staff ? `<button class="btn small" onclick="B.startMeeting('${m.id}')">Start meeting</button>` : `<a class="btn small hide-sm" href="#/meeting/${m.id}">Details</a>`}</li>`).join('')}</ul></div>` : ''}`;
  }

  // ---- minutes of the meetings (includes the archive) ----
  function minutesListView() {
    const list = S.meetings.filter((m) => ['held', 'closed'].includes(m.status)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const st = (m) => { const s = m.minutes ? m.minutes.status : null; return s === 'signed' ? '<span class="chip ok">Signed</span>' : s === 'circulated' ? '<span class="chip brand">Out for signature</span>' : s === 'draft' ? '<span class="chip warn">Draft</span>' : '<span class="chip">No minutes</span>'; };
    return `<div class="page-head"><div><h1>Minutes of the Meetings</h1><p class="muted">Minutes, papers and attendance for every meeting held, kept permanently.</p></div></div>
      <div class="card flush table-wrap"><table><tr><th>Meeting</th><th>Held on</th><th class="hide-sm">Attendance</th><th>Minutes</th><th>Records</th></tr>
      ${list.map((m) => { const at = Object.values(m.attendance || {}); return `<tr><td><b>${esc(m.title)}</b><div class="faint">${esc(body(m.body).name)}</div></td><td>${fmtDate(m.date)}</td><td class="hide-sm">${at.filter((x) => x === 'present' || x === 'virtual').length} of ${at.length}</td><td>${st(m)}</td>
        <td><div class="btns">${m.minutes ? `<a class="btn small" href="#/minutes/${m.id}">Open</a>` : ''}${papersOf(m.id).length ? `<a class="btn small hide-sm" href="#/pack/${m.id}">Papers</a>` : ''}</div></td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">No meetings held yet.</td></tr>'}
      </table></div>`;
  }

  // ---- settings (tabs) ----
  function settingsTabs(cur) {
    const tabs = [['settings', 'General'], me().role === 'cs' ? ['users', 'Users'] : ['members', 'Members'], ['activity', 'Activity'], ['compliance', 'Compliance']];
    return `<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<a href="#/cs/${k}" role="tab" class="${cur === k ? 'active' : ''}" ${cur === k ? 'aria-selected="true"' : ''}>${l}</a>`).join('')}</div>`;
  }
  function mySettingsView() {
    const u = me();
    return `<div class="page-head"><div><h1>Settings</h1></div></div>
      <div class="card" style="max-width:640px"><h2>My profile</h2><dl class="kv"><dt>Name</dt><dd>${esc(u.name)}</dd><dt>Title</dt><dd>${esc(u.title)}</dd><dt>User ID</dt><dd class="mono">${esc(u.username || '')}</dd><dt>Email</dt><dd>${esc(u.email || '—')}</dd><dt>Mobile</dt><dd>${esc(u.mobile || '—')}</dd></dl>
        <p class="faint">To change your contact details, ask the Company Secretary.</p><a class="btn" href="#/password">${ms('key')}Change password</a></div>`;
  }

  // ---- live meeting ----
  function liveView(id) {
    const m = meeting(id);
    if (!m) return notFound();
    if (m.status !== 'live') return `<div class="card empty"><h2>${esc(m.title)}</h2><p>This meeting is not live${m.status === 'scheduled' ? ` yet. It is scheduled for ${fmtDate(m.date)}.` : '.'}</p><a class="btn" href="#/meeting/${m.id}">Back to meeting</a></div>`;
    const u = me();
    const joined = ['present', 'virtual'].includes(m.attendance[u.id]);
    const it = m.agenda[m.liveItem] || m.agenda[0];
    const b = body(m.body);
    const present = Object.values(m.attendance).filter((x) => x === 'present' || x === 'virtual').length;
    const quorate = present >= m.quorum;
    const t = { for: 0, against: 0, abstain: 0 };
    Object.values(it.votes || {}).forEach((v) => { t[v]++; });
    const voters = b.members.filter((x) => user(x).voting);
    const paper = papersOf(m.id).find((p) => p.itemId === it.id);
    let main = '';
    if (isMember(m) && !joined) {
      main += `<div class="card checkin"><h2>Mark your attendance</h2><p class="muted">Join to be counted for the quorum, approve the agenda, vote and post suggestions.</p>
        <div class="btns"><button class="btn primary" onclick="B.join('${m.id}','present')">${ms('meeting_room')}I'm in the room</button><button class="btn tonal" onclick="B.join('${m.id}','virtual')">${ms('videocam')}Joining by video</button></div></div>`;
    }
    const av = m.agendaVote;
    if (av || isStaff()) {
      const at = { approve: 0, object: 0 };
      Object.values((av && av.votes) || {}).forEach((v) => { at[v]++; });
      const mineA = av && av.votes[u.id];
      let ac = `<div class="card agenda-approval"><div class="card-head"><h2>Approval of the agenda</h2>${av ? (av.status === 'open' ? '<span class="chip warn">Open</span>' : av.status === 'approved' ? '<span class="chip ok">Approved</span>' : '<span class="chip bad">Not approved</span>') : ''}</div>`;
      if (!av) ac += `<p class="muted">Ask the members present to approve the agenda before the business begins.</p><button class="btn primary" onclick="B.act('agendaVote.open',{meetingId:'${m.id}'},'Agenda approval is open')">${ms('how_to_vote')}Ask members to approve the agenda</button>`;
      else {
        ac += `<p class="faint">${at.approve} approve · ${at.object} object · ${present - Object.keys(av.votes).length > 0 ? present - Object.keys(av.votes).length : 0} present yet to respond${av.closedAt ? ' · closed ' + fmtDT(av.closedAt) : ''}</p>`;
        if (av.status === 'open' && isMember(m) && joined) ac += `<div class="vote-btns"><button class="btn ${mineA === 'approve' ? 'sel' : ''}" onclick="B.act('agendaVote.respond',{meetingId:'${m.id}',choice:'approve'})">${ms('thumb_up')}Approve</button><button class="btn ${mineA === 'object' ? 'sel' : ''}" onclick="B.act('agendaVote.respond',{meetingId:'${m.id}',choice:'object'})">${ms('thumb_down')}Object</button></div>`;
        if (av.status === 'open' && isStaff()) ac += `<div class="btns" style="margin-top:12px"><button class="btn primary" onclick="B.act('agendaVote.close',{meetingId:'${m.id}'},'Agenda approval recorded')">Close and record</button></div>`;
      }
      main += ac + '</div>';
    }
    main += `<div class="card live-item"><div class="faint">Item ${it.no} of ${m.agenda.length} · ${it.type === 'decision' ? 'For decision' : 'For information'} · presented by ${esc(uname(it.presenter))}</div>
      <h1 style="margin-top:6px">${esc(it.title)}</h1>
      ${it.resolutionText ? `<p class="body-large">${esc(it.resolutionText)}</p>` : ''}
      ${paper ? `<a class="btn small" href="#/paper/${paper.id}">Open paper</a>` : ''}
      ${it.outcome ? `<p style="margin-top:12px"><span class="chip ${OUTCOME[it.outcome][1]}">${OUTCOME[it.outcome][0]}</span></p>` : ''}`;
    if (it.type === 'decision' && (it.voteOpen || Object.keys(it.votes || {}).length)) {
      const n = voters.length || 1;
      main += `<div style="margin-top:16px"><div class="bar"><span style="width:${t.for / n * 100}%;background:var(--ok)"></span><span style="width:${t.against / n * 100}%;background:var(--bad)"></span><span style="width:${t.abstain / n * 100}%;background:var(--ink-3)"></span></div>
        <p class="faint" style="margin-top:6px">${t.for} for · ${t.against} against · ${t.abstain} abstained · ${voters.length - Object.keys(it.votes).length} yet to vote${it.voteOpen ? ' · <b style="color:var(--bad)">voting open</b>' : ''}</p></div>`;
    }
    if (it.voteOpen && u.voting && isMember(m) && joined) {
      const mine = it.votes[u.id];
      main += `<h3 style="margin-top:16px">Your vote${mine ? ': <span style="color:var(--brand)">' + mine + '</span>' : ''}</h3><div class="vote-btns">
        <button class="btn ${mine === 'for' ? 'sel' : ''}" onclick="B.vote('${m.id}','${it.id}','for')">For</button>
        <button class="btn ${mine === 'against' ? 'sel' : ''}" onclick="B.vote('${m.id}','${it.id}','against')">Against</button>
        <button class="btn ${mine === 'abstain' ? 'sel' : ''}" onclick="B.vote('${m.id}','${it.id}','abstain')">Abstain</button></div>`;
    }
    main += '</div>';
    const sugs = it.suggestions || [];
    const canPost = isStaff() || (isMember(m) && joined);
    main += `<div class="card suggestions"><div class="card-head"><h2>Suggestions on item ${it.no}</h2><span class="chip">${sugs.length}</span></div>
      ${sugs.length ? `<ul class="list">${sugs.map((x) => `<li class="row" style="padding:12px 0;align-items:flex-start"><span class="avatar">${initials(uname(x.by))}</span><div class="grow"><div><b>${esc(uname(x.by))}</b> <span class="faint">${fmtDT(x.at)}</span></div><p style="margin:4px 0 0">${esc(x.text)}</p></div>
        ${x.status === 'adopted' ? '<span class="chip ok">In the minutes</span>' : isStaff() ? `<button class="btn small" onclick="B.act('suggest.adopt',{meetingId:'${m.id}',itemId:'${it.id}',id:'${x.id}'},'Added to the minutes notes')">Add to minutes</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted">No suggestions on this item yet.</p>'}
      ${canPost ? `<form class="sugg-form" onsubmit="event.preventDefault(); B.suggest('${m.id}','${it.id}', this.t)"><textarea name="t" placeholder="Suggest a change or raise a point on this item…" maxlength="1000" style="min-height:72px"></textarea><div class="btns" style="margin-top:8px"><button class="btn primary">${ms('send')}Post suggestion</button></div></form>` : isMember(m) ? '<p class="faint">Mark your attendance to post a suggestion.</p>' : ''}
    </div>`;
    if (isStaff()) {
      main += `<div class="card"><h2>Secretary's console</h2>
        <div class="btns">
          <button class="btn" ${m.liveItem === 0 ? 'disabled' : ''} onclick="B.act('live.goto',{meetingId:'${m.id}',index:${m.liveItem - 1}})">${ms('arrow_back')}Previous</button>
          <button class="btn" ${m.liveItem >= m.agenda.length - 1 ? 'disabled' : ''} onclick="B.act('live.goto',{meetingId:'${m.id}',index:${m.liveItem + 1}})">Next${ms('arrow_forward')}</button>
          ${it.type === 'decision' ? (it.voteOpen ? `<button class="btn primary" onclick="B.act('vote.close',{meetingId:'${m.id}',itemId:'${it.id}'},'Vote closed')">Close vote and record result</button>` : `<button class="btn primary" onclick="B.act('vote.open',{meetingId:'${m.id}',itemId:'${it.id}'},'Voting is open')">${Object.keys(it.votes).length ? 'Re-open vote' : 'Open vote'}</button>`) : `<button class="btn" onclick="B.act('item.outcome',{meetingId:'${m.id}',itemId:'${it.id}',outcome:'noted'},'Noted')">Mark noted</button>`}
          <button class="btn" onclick="B.act('item.outcome',{meetingId:'${m.id}',itemId:'${it.id}',outcome:'deferred'},'Deferred')">Defer</button>
        </div>
        <label>Discussion notes for the minutes</label><textarea id="disc-${it.id}" onblur="B.saveDiscussion('${m.id}','${it.id}')">${esc(it.discussion)}</textarea>
        <hr class="divider">
        <button class="btn danger" onclick="B.endMeeting('${m.id}')">End meeting and draft minutes</button>
      </div>`;
    }
    const side = `<div class="card"><h2>Agenda</h2><ul class="list agenda-list">${m.agenda.map((x, i) => `<li class="${i === m.liveItem ? 'current' : x.outcome ? 'done' : ''}"><span>${x.no}.</span><span style="flex:1">${esc(x.title)}</span>${(x.suggestions || []).length ? `<span class="faint" style="display:inline-flex;align-items:center;gap:2px">${ms('forum', 'sm')}${x.suggestions.length}</span>` : ''}${x.outcome ? `<span class="chip ${OUTCOME[x.outcome][1]}">${OUTCOME[x.outcome][0]}</span>` : ''}</li>`).join('')}</ul></div>
      <div class="card"><div class="card-head"><h2>Attendance</h2><span class="chip ${quorate ? 'ok' : 'bad'}">${present} present · quorum ${m.quorum}</span></div>
      <ul class="list">${b.members.map((x) => `<li class="row" style="padding:8px 0"><span class="avatar">${initials(uname(x))}</span><div class="grow">${esc(uname(x))}${m.joinedAt && m.joinedAt[x] && ['present', 'virtual'].includes(m.attendance[x]) ? `<div class="faint">Joined ${fmtDT(m.joinedAt[x])}</div>` : ''}</div>
        ${isStaff() ? `<select onchange="B.act('live.attendance',{meetingId:'${m.id}',userId:'${x}',status:this.value})" class="att">${['present', 'virtual', 'apologies', 'absent'].map((s) => `<option value="${s}" ${m.attendance[x] === s ? 'selected' : ''}>${s === 'virtual' ? 'By video' : s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select>` : `<span class="chip ${['present', 'virtual'].includes(m.attendance[x]) ? 'ok' : ''}">${{ present: 'Present', virtual: 'By video', apologies: 'Apologies', absent: 'Not joined' }[m.attendance[x]] || '—'}</span>`}</li>`).join('')}</ul></div>`;
    return `<div class="banner live"><span style="display:flex;align-items:center;gap:8px">${ms('radio_button_checked', 'fill')} Live · ${esc(m.title)}</span>${m.videoLink ? `<a class="btn small" href="${esc(m.videoLink)}" target="_blank" rel="noopener">Video link</a>` : ''}</div>
      <div class="split"><div>${main}</div><div>${side}</div></div>`;
  }

  // ---- minutes ----
  function minutesView(id) {
    const m = meeting(id);
    if (!m || !m.minutes) return notFound();
    const b = body(m.body);
    const mn = m.minutes;
    const u = me();
    const signers = [b.chair, csId()];
    const canSign = mn.status === 'circulated' && signers.includes(u.id) && !mn.signatures[u.id];
    const st = { draft: ['Draft', 'warn'], circulated: ['Out for signature', 'brand'], signed: ['Signed and sealed', 'ok'] }[mn.status];
    return `<div class="page-head"><div><a href="#/meeting/${m.id}" class="faint" style="display:inline-flex;align-items:center;gap:4px;min-height:32px">${ms('arrow_back', 'sm')} ${esc(m.title)}</a><h1>Minutes</h1><span class="chip ${st[1]}">${st[0]}</span></div></div>
      <div class="split">
        <div class="letter">${isStaff() && mn.status !== 'signed' ? `<textarea id="minText" style="min-height:520px;border:0;padding:0;font:400 16px/26px var(--font)">${esc(mn.text)}</textarea>` : `<div class="minutes-text">${esc(mn.text)}</div>`}
          ${mn.status === 'signed' ? `<div style="display:flex;gap:40px;margin-top:28px;flex-wrap:wrap">${signers.map((s) => `<div><div class="seal">${ms('verified', 'sm')} ${fmtDT(mn.signatures[s])}</div><div style="margin-top:6px"><b>${esc(uname(s))}</b><br><span class="faint">${s === b.chair ? 'Chair' : 'Company Secretary'}</span></div></div>`).join('')}</div>` : ''}
        </div>
        <div>
          <div class="card"><h2>Signatures</h2>${signers.map((s) => `<div class="check ${mn.signatures[s] ? 'ok' : 'bad'}"><span class="mark">${ms(mn.signatures[s] ? 'check' : 'more_horiz')}</span><div><b>${esc(uname(s))}</b> · ${s === b.chair ? 'Chair' : 'Company Secretary'}<div class="faint">${mn.signatures[s] ? 'Signed ' + fmtDT(mn.signatures[s]) : 'Not yet signed'}</div></div></div>`).join('')}
            ${canSign ? `<button class="btn primary big" style="width:100%;margin-top:12px" onclick="B.signMinutes('${m.id}')">Sign with one-time code</button>` : ''}
          </div>
          ${isStaff() && mn.status !== 'signed' ? `<div class="card"><h2>Secretary</h2><div class="btns"><button class="btn" onclick="B.saveMinutes('${m.id}')">Save changes</button>${mn.status === 'draft' ? `<button class="btn primary" onclick="B.circulate('${m.id}')">Circulate for signature</button>` : ''}</div>${mn.status === 'circulated' ? '<p class="faint" style="margin-top:8px">Editing circulated minutes clears any signatures already given.</p>' : ''}</div>` : ''}
        </div>
      </div>`;
  }

  // ---- records ----
  function resolutionsView() {
    const q = (sessionStorage.getItem ? (() => { try { return sessionStorage.getItem('b360.rq') || ''; } catch (e) { return ''; } })() : '');
    const list = S.resolutions.slice().sort((a, b) => b.passedOn.localeCompare(a.passedOn)).filter((r) => !q || (r.title + r.text + r.ref).toLowerCase().includes(q.toLowerCase()));
    return `<div class="page-head"><div><h1>Resolution register</h1><p class="muted">Every resolution passed, with its vote. Search instead of opening cupboards.</p></div></div>
      <input placeholder="Search resolutions, e.g. dividend" value="${esc(q)}" oninput="B.rsearch(this.value)" style="margin-bottom:14px">
      <div class="card flush">${list.map((r) => `<div class="row" style="align-items:flex-start"><div class="icon-dot">${esc(body(r.body).code)}</div><div class="grow"><div class="title">${esc(r.title)}</div><p class="muted" style="margin:4px 0">${esc(r.text)}</p>
        <div class="faint">${esc(r.ref)} · ${fmtDate(r.passedOn)} · ${r.tally.for} for, ${r.tally.against} against, ${r.tally.abstain} abstained · <a href="#/meeting/${r.meetingId}">meeting</a></div></div></div>`).join('') || '<div class="empty">No resolutions match.</div>'}</div>`;
  }
  let lastAsk = null;
  function askView() {
    return `<div class="page-head"><div><h1>Ask the record</h1><p class="muted">Ask what the Board decided, in plain words. Answers come only from the resolution register and cite their source.</p></div></div>
      <div class="card"><form onsubmit="event.preventDefault(); B.ask(this.q.value)" class="btns"><input name="q" placeholder="What did the Board decide about the dividend?" style="flex:1;min-width:200px" value="${esc(lastAsk ? lastAsk.q : '')}"><button class="btn primary">Ask</button></form>
        <div class="btns" style="margin-top:10px">${['What did we decide on the dividend?', 'Who was appointed CFO?', 'Solar project cost', 'Budget for FY2027'].map((x) => `<button class="btn small" onclick="B.ask('${x}')">${x}</button>`).join('')}</div></div>
      ${lastAsk ? `<div class="card"><h3>Answer</h3><p class="body-large">${esc(lastAsk.answer)}</p>${lastAsk.sources.length ? `<div class="faint">Sources: ${lastAsk.sources.map((s) => `<a href="#/meeting/${s.meetingId}">${esc(s.ref)}</a> (${fmtDate(s.passedOn)})`).join(' · ')}</div>` : ''}<p class="faint" style="margin-top:8px">Demo: answers are found by searching the register, not generated.</p></div>` : ''}`;
  }

  // ---- CS screens ----
  function csNewView() {
    const d = new Date(S.today + 'T00:00:00Z');
    const plus = (n) => new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
    return `<div class="page-head"><div><h1>New meeting</h1><p class="muted">Propose dates; members answer the poll; the notice drafts itself once you confirm.</p></div></div>
      <form class="card" onsubmit="event.preventDefault(); B.createMeeting(this)" style="max-width:640px">
        <label>Body</label><select name="bodyId">${S.bodies.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>
        <label>Proposed dates</label><div class="grid3"><input type="date" name="d1" value="${plus(14)}" required><input type="date" name="d2" value="${plus(16)}"><input type="date" name="d3" value="${plus(21)}"></div>
        <div class="grid2"><div><label>Time</label><input type="time" name="time" value="11:00"></div><div><label>Poll closes</label><input type="date" name="closesOn" value="${plus(5)}"></div></div>
        <label>Venue</label><input name="venue" value="Board Room, Head Office, Lahore">
        <label>Video link (Teams, Zoom or Meet)</label><input name="videoLink" placeholder="https://">
        <button class="btn primary big" style="margin-top:16px">Create and open poll</button>
      </form>`;
  }
  function csComplianceView() {
    return `<div class="page-head"><div><h1>Compliance</h1><p class="muted">Rule pack: ${esc(S.rulePack.label)}. Notice period ${S.rulePack.noticeDays} days; quorum ${esc(S.rulePack.quorum)}.</p></div></div>
      <div class="card flush table-wrap"><table><tr><th>Requirement</th><th class="hide-sm">Reference</th><th>Due</th><th>Status</th></tr>
      ${S.compliance.slice().sort((a, b) => a.due.localeCompare(b.due)).map((c) => { const late = c.status !== 'filed' && daysTo(c.due) < 0; const soon = c.status !== 'filed' && daysTo(c.due) <= 14; return `<tr><td><b>${esc(c.title)}</b></td><td class="hide-sm faint">${esc(c.ref)}</td><td>${fmtDate(c.due)}${c.status !== 'filed' ? `<div class="faint">${daysTo(c.due) >= 0 ? daysTo(c.due) + ' days left' : -daysTo(c.due) + ' days overdue'}</div>` : ''}</td>
        <td>${c.status === 'filed' ? '<span class="chip ok">Done</span>' : `<span class="chip ${late ? 'bad' : soon ? 'warn' : ''}">Pending</span> <button class="btn small" onclick="B.act('compliance.set',{id:'${c.id}',status:'filed'},'Marked done')">Mark done</button>`}</td></tr>`; }).join('')}
      </table></div>`;
  }
  function csFeesView() {
    const rows = [];
    Object.entries(S.fees).forEach(([mid, f]) => { const m = meeting(mid); if (!m) return; Object.entries(f).forEach(([uid, st]) => rows.push({ m, uid, st, amt: body(m.body).fee })); });
    rows.sort((a, b) => (a.st === 'due' ? 0 : 1) - (b.st === 'due' ? 0 : 1) || (b.m.date || '').localeCompare(a.m.date || ''));
    const due = rows.filter((r) => r.st === 'due').reduce((a, r) => a + r.amt, 0);
    return `<div class="page-head"><div><h1>Directors' meeting fees</h1><p class="muted">Calculated from recorded attendance, so Finance never has to search the registers. ${pkr(due)} due.</p></div></div>
      <div class="card flush table-wrap"><table><tr><th>Director</th><th>Meeting</th><th>Fee</th><th>Status</th></tr>
      ${rows.filter((r) => user(r.uid).role !== 'ceo').map((r) => `<tr><td>${esc(uname(r.uid))}</td><td>${esc(r.m.title)}<div class="faint">${fmtDate(r.m.date)}</div></td><td>${pkr(r.amt)}</td><td>${r.st === 'paid' ? '<span class="chip ok">Paid</span>' : `<button class="btn small" onclick="B.act('fees.pay',{meetingId:'${r.m.id}',userId:'${r.uid}'},'Marked paid')">Mark paid</button>`}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No fees yet.</td></tr>'}
      </table></div><p class="faint">Executive directors (CEO) receive no meeting fee and are left out.</p>`;
  }
  function csMembersView() {
    return `<div class="page-head"><div><h1>Members register</h1><p class="muted">Notices go to these addresses by email and SMS. Every recipient needs both.</p></div></div>
      <div class="card flush table-wrap"><table><tr><th>Name</th><th>Bodies</th><th>Email</th><th>Mobile</th><th></th></tr>
      ${S.users.map((u) => `<tr><td><b>${esc(u.name)}</b><div class="faint">${esc(u.title)}</div></td><td class="faint">${S.bodies.filter((b) => b.members.includes(u.id)).map((b) => b.code).join(', ') || '—'}</td>
        <td><input id="em-${u.id}" value="${esc(u.email)}" style="min-width:180px"></td><td><input id="mo-${u.id}" value="${esc(u.mobile)}" placeholder="+92 3xx xxxxxxx" style="min-width:150px;${u.mobile ? '' : 'border-color:var(--bad)'}"></td>
        <td><button class="btn small" onclick="B.saveMember('${u.id}')">Save</button></td></tr>`).join('')}
      </table></div>`;
  }
  const ROLE_OPTS = [['chairman', 'Chairman'], ['director', 'Director'], ['ceo', 'CEO'], ['cs', 'Company Secretary'], ['csa', 'CS Assistant']];
  function usersView() {
    const list = S.users.slice().sort((a, b) => (b.active !== false) - (a.active !== false) || ROLE_OPTS.findIndex((r) => r[0] === a.role) - ROLE_OPTS.findIndex((r) => r[0] === b.role));
    return `<div class="page-head"><div><h1>Users</h1><p class="muted">Who can sign in, what they can do, and which Board and committees they sit on. Only the Company Secretary manages users.</p></div><a class="btn primary" href="#/cs/users/new">Add user</a></div>
      <div class="card flush table-wrap"><table><tr><th>Name</th><th>User ID</th><th>Role</th><th class="hide-sm">Board and committees</th><th class="hide-sm">Contact</th><th>Status</th></tr>
      ${list.map((u) => `<tr class="action-row" onclick="location.hash='#/cs/users/${u.id}'"><td><a href="#/cs/users/${u.id}"><b>${esc(u.name)}</b></a><div class="faint">${esc(u.title)}</div></td>
        <td class="mono">${esc(u.username || '')}</td><td>${ROLE[u.role]}${u.voting ? '' : ' <span class="faint">· no vote</span>'}</td>
        <td class="hide-sm faint">${S.bodies.filter((b) => b.members.includes(u.id)).map((b) => b.code + (b.chair === u.id ? ' (Chair)' : '')).join(', ') || '—'}</td>
        <td class="hide-sm faint">${esc(u.email || '—')}<br>${u.mobile ? esc(u.mobile) : '<span class="text-error">No mobile</span>'}</td>
        <td>${u.active === false ? '<span class="chip">Deactivated</span>' : u.mustChange ? '<span class="chip warn">Must set password</span>' : '<span class="chip ok">Active</span>'}</td></tr>`).join('')}
      </table></div>
      <div class="card"><h2>Chairs</h2><p class="muted">The Chair approves the agenda and signs the minutes.</p>
        ${S.bodies.map((b) => `<label>${esc(b.name)}</label><select onchange="B.act('body.setChair',{bodyId:'${b.id}',userId:this.value},'Chair updated')">${S.users.filter((u) => u.active !== false && !['cs', 'csa'].includes(u.role)).map((u) => `<option value="${u.id}" ${b.chair === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>`).join('')}
      </div>`;
  }
  function userFormView(id) {
    const isNew = id === 'new';
    const u = isNew ? { name: '', title: '', role: 'director', email: '', mobile: '', voting: true, username: '' } : S.users.find((x) => x.id === id);
    if (!u) return notFound();
    const self = u.id === me().id;
    return `<div class="page-head"><div><a href="#/cs/users" class="faint" style="display:inline-flex;align-items:center;gap:4px;min-height:32px">${ms('arrow_back', 'sm')} Users</a><h1>${isNew ? 'Add user' : esc(u.name)}</h1>${!isNew ? (u.active === false ? '<span class="chip">Deactivated</span>' : '<span class="chip ok">Active</span>') : ''}</div></div>
      <div class="split">
      <form class="card" id="userForm" onsubmit="event.preventDefault(); B.saveUser('${isNew ? '' : u.id}', this)">
        <div class="grid2"><div><label>Full name</label><input name="name" value="${esc(u.name)}" required></div><div><label>Title</label><input name="title" value="${esc(u.title)}" placeholder="e.g. Independent Director"></div></div>
        <div class="grid2"><div><label>Role</label><select name="role" ${self ? 'disabled' : ''}>${ROLE_OPTS.map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div><label>User ID</label><input name="username" value="${esc(u.username)}" placeholder="${isNew ? 'Leave blank to create from the name' : ''}" autocapitalize="none" spellcheck="false"></div></div>
        <div class="grid2"><div><label>Email</label><input name="email" type="email" value="${esc(u.email)}"></div><div><label>Mobile (for sign-in codes and notices)</label><input name="mobile" value="${esc(u.mobile)}" placeholder="+92 3xx xxxxxxx"></div></div>
        <label><input type="checkbox" name="voting" ${u.voting ? 'checked' : ''} >Has a vote at meetings (not used for the Company Secretary's office)</label>
        <label>Board and committees</label>
        ${S.bodies.map((b) => `<label><input type="checkbox" name="body_${b.id}" ${!isNew && b.members.includes(u.id) ? 'checked' : ''} >${esc(b.name)}${b.chair === u.id ? ' <span class="chip brand">Chair</span>' : ''}</label>`).join('')}
        ${isNew ? `<label>Temporary password</label><div class="btns"><input name="password" id="newPw" value="${tempPassword()}" style="flex:1" class="mono"><button type="button" class="btn" onclick="document.getElementById('newPw').value=B.tempPassword()">New</button></div><p class="faint">Give this to the user. They must choose their own password the first time they sign in.</p>` : ''}
        <button class="btn primary big" style="margin-top:16px">${isNew ? 'Add user' : 'Save changes'}</button>
      </form>
      <div>${isNew ? '' : `<div class="card"><h2>Password</h2><p class="muted">${u.mustChange ? 'Waiting for them to set their own password.' : 'They have set their own password.'}</p><button class="btn" onclick="B.resetPassword('${u.id}')">Reset password</button><p class="faint" style="margin-top:8px">Resetting signs them out everywhere and gives them a temporary password.</p></div>
        ${self ? '' : `<div class="card"><h2>Access</h2>${u.active === false ? `<p class="muted">This user cannot sign in.</p><button class="btn" onclick="B.act('user.setActive',{userId:'${u.id}',active:true},'User reactivated')">Reactivate</button><p class="faint" style="margin-top:8px">Add them back to the Board or committees above after reactivating.</p>` : `<p class="muted">Deactivating stops them signing in and removes them from the Board and committees. Their past records stay.</p><button class="btn danger" onclick="B.deactivate('${u.id}')">Deactivate</button>`}</div>`}`}
      </div></div>`;
  }
  function tempPassword() {
    const w = 'abcdefghjkmnpqrstuvwxyz', d = '23456789';
    let p = '';
    for (let i = 0; i < 6; i++) p += w[Math.floor(Math.random() * w.length)];
    return p[0].toUpperCase() + p.slice(1) + '-' + d[Math.floor(Math.random() * d.length)] + d[Math.floor(Math.random() * d.length)] + d[Math.floor(Math.random() * d.length)];
  }
  function passwordView(forced) {
    return `<div class="page-head"><div><h1>${forced ? 'Choose your password' : 'Change password'}</h1><p class="muted">${forced ? 'You signed in with a temporary password. Choose your own before you continue.' : `Signed in as <span class="mono">${esc(me().username)}</span>.`}</p></div></div>
      <form class="card" style="max-width:480px" onsubmit="event.preventDefault(); B.changePassword(this)">
        <label>${forced ? 'Temporary password' : 'Current password'}</label><input name="current" type="password" autocomplete="current-password" required>
        <label>New password</label><input name="next" type="password" autocomplete="new-password" required>
        <label>New password again</label><input name="again" type="password" autocomplete="new-password" required>
        <p class="faint" style="margin-top:8px">At least 8 characters, with letters and at least one number.</p>
        <div class="btns" style="margin-top:12px"><button class="btn primary">Save password</button>${forced ? '<button type="button" class="btn" onclick="B.signOut()">Sign out</button>' : ''}</div>
      </form>`;
  }
  function csActivityView() {
    return `<div class="page-head"><div><h1>Activity log</h1><p class="muted">Every action is also written to a permanent audit table in the database.</p></div></div>
      <div class="card flush"><ul class="list">${S.activity.map((a) => `<li class="row"><div class="grow">${esc(a.text)}<div class="faint">${fmtDT(a.at)} · ${esc(a.who === 'system' ? 'System' : uname(a.who))}</div></div></li>`).join('')}</ul></div>`;
  }
  function csSettingsView() {
    return `<div class="card" style="max-width:640px"><h2>Company</h2><dl class="kv"><dt>Name</dt><dd>${esc(S.company.name)}</dd><dt>Registration</dt><dd>${esc(S.company.regNo)}</dd><dt>Address</dt><dd>${esc(S.company.address)}</dd></dl>
        <label>Rule pack</label><select onchange="B.act('settings.rulePack',{rulePack:this.value},'Rule pack updated')" ${me().role !== 'cs' ? 'disabled' : ''}>${Object.entries(S.rulePacks).map(([k, v]) => `<option value="${k}" ${k === S.company.rulePack ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        <p class="faint" style="margin-top:6px">Sets the notice period, quorum and filing rules. Pakistan's Companies Act 2017 and SECP rules are the default.</p></div>
      <div class="card" style="max-width:640px"><h2>Demo data</h2><p class="muted">Put every meeting, notice, vote and signature back to the starting demo. Everyone testing sees the reset.</p><button class="btn danger" onclick="B.resetDemo()">Reset demo data</button></div>`;
  }
  function notFound() { return '<div class="card empty"><h2>Not found</h2><p>This item does not exist or you do not have access to it.</p><a class="btn" href="#/home">Home</a></div>'; }

  // ---------------- router ----------------
  function route() { return (location.hash || '#/home').slice(2) || 'home'; }
  function render() {
    const app = $('#app');
    if (!token || !S) { app.innerHTML = signInView(); return; }
    const r = route();
    const [a, b, c] = r.split('/');
    const staffOnly = { cs: true };
    let v;
    if (me().mustChange) v = passwordView(true);
    else if (staffOnly[a] && !isStaff()) v = notFound();
    else if (a === 'home') v = homeView();
    else if (a === 'meetings') v = meetingsView(b);
    else if (a === 'meeting') v = meetingView(b);
    else if (a === 'notices') v = noticesView();
    else if (a === 'notice') v = noticeView(b);
    else if (a === 'paper') v = paperView(b);
    else if (a === 'pack') v = packView(b);
    else if (a === 'live') v = b ? liveView(b) : liveRoomView();
    else if (a === 'papers') v = papersView();
    else if (a === 'settings') v = mySettingsView();
    else if (a === 'minutes') v = b ? minutesView(b) : minutesListView();
    else if (a === 'resolutions') v = resolutionsView();
    else if (a === 'archive') v = minutesListView();
    else if (a === 'ask') v = askView();
    else if (a === 'cs' && b === 'notice') v = csNoticeView(c);
    else if (a === 'cs' && b === 'register') v = csRegisterView();
    else if (a === 'cs' && b === 'new') v = csNewView();
    else if (a === 'cs' && b === 'compliance') v = csComplianceView();
    else if (a === 'cs' && b === 'fees') v = csFeesView();
    else if (a === 'cs' && b === 'members') v = csMembersView();
    else if (a === 'cs' && b === 'users' && me().role === 'cs') v = c ? userFormView(c) : usersView();
    else if (a === 'password') v = passwordView();
    else if (a === 'cs' && b === 'activity') v = csActivityView();
    else if (a === 'cs' && b === 'settings') v = csSettingsView();
    else v = notFound();
    if (a === 'cs' && ['settings', 'activity', 'compliance', 'members'].concat(me().role === 'cs' && !c ? ['users'] : []).includes(b) && isStaff()) {
      v = `<div class="page-head"><div><h1>Settings</h1></div></div>${settingsTabs(b)}` + v.replace('<h1>', '<h2 class="headline-small">').replace('</h1>', '</h2>');
    }
    app.innerHTML = shell(v, r);
  }
  window.addEventListener('hashchange', () => { navOpen = false; render(); window.scrollTo(0, 0); });

  // ---------------- modal (one-time code) ----------------
  function otpModal(title, explain, purpose, onCode) {
    api('/api/otp', { purpose }).then((d) => {
      $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal"><h2>${esc(title)}</h2><p class="muted">${esc(explain)}</p>
        <div class="sms"><small>Simulated SMS to ${esc(d.simulatedSms.to)}</small>Your Boardroom 360 code is <b>${esc(d.simulatedSms.code)}</b></div>
        <form id="otpForm"><input id="mOtp" class="otp-input" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="one-time-code">
        <div class="btns" style="margin-top:14px"><button class="btn primary big" style="flex:1">Confirm</button><button type="button" class="btn big" id="mCancel">Cancel</button></div></form></div></div>`;
      $('#mOtp').focus();
      $('#mCancel').onclick = closeModal;
      $('#otpForm').onsubmit = async (e) => {
        e.preventDefault();
        try { await onCode($('#mOtp').value); closeModal(); } catch (err) { /* toast shown */ }
      };
    }).catch((e) => toast(e.message, true));
  }
  function promptModal(title, fields, onOk) {
    $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal"><h2>${esc(title)}</h2><form id="pForm">${fields.map((f) => `<label>${esc(f.label)}</label>${f.type === 'textarea' ? `<textarea name="${f.name}"></textarea>` : `<input name="${f.name}" type="${f.type || 'text'}" ${f.required ? 'required' : ''}>`}`).join('')}
      <div class="btns" style="margin-top:14px"><button class="btn primary" style="flex:1">Continue</button><button type="button" class="btn" id="pCancel">Cancel</button></div></form></div></div>`;
    $('#pCancel').onclick = closeModal;
    $('#pForm').onsubmit = async (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); try { await onOk(v); closeModal(); } catch (err) { /* toast shown */ } };
  }
  function showInfo(title, html) {
    $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal"><h2>${esc(title)}</h2>${html}<div class="btns" style="margin-top:14px"><button class="btn primary" id="iOk" style="flex:1">Done</button></div></div></div>`;
    $('#iOk').onclick = closeModal;
  }
  function closeModal() { $('#modal-root').innerHTML = ''; render(); }

  // ---------------- handlers ----------------
  function signOut() { token = null; S = null; store.del('b360.token'); store.del('b360.pending'); location.hash = '#/home'; render(); }
  window.B = {
    act,
    signOut,
    toggleNav() { navOpen = !navOpen; render(); },
    openMore() { moreSheet(); },
    closeSheet() { $('#modal-root').innerHTML = ''; },
    closeNav() { if (navOpen) { navOpen = false; } },
    async passwordLogin(f) {
      try {
        const d = await api('/api/login/password', { username: f.username.value, password: f.password.value });
        store.set('b360.pending', JSON.stringify({ userId: d.userId, name: d.name, to: d.simulatedSms.to, code: d.simulatedSms.code }));
        render();
        setTimeout(() => { const el = $('#otp'); if (el) el.focus(); }, 50);
      } catch (e) { toast(e.message, true); }
    },
    async verifyLogin() {
      let p; try { p = JSON.parse(store.get('b360.pending')); } catch (e) { p = null; }
      if (!p) return render();
      try {
        const d = await api('/api/login/verify', { userId: p.userId, code: $('#otp').value });
        token = d.token; store.set('b360.token', token); store.del('b360.pending');
        await refresh(true);
        location.hash = '#/home';
        render();
      } catch (e) { toast(e.message, true); }
    },
    cancelLogin() { store.del('b360.pending'); render(); },
    rsvp(meetingId, response) { act('rsvp', { meetingId, response }, 'Reply saved'); },
    ack(noticeId, reply) { act('notice.ack', { noticeId, reply }, 'Thank you. Receipt acknowledged.'); },
    closePoll(meetingId) {
      const date = $('#pollDate').value;
      act('poll.close', { meetingId, date }, 'Date confirmed. Notice drafted.').then((r) => { if (r && r.noticeId) location.hash = '#/cs/notice/' + r.noticeId; });
    },
    draftNotice(meetingId) { act('notice.draft', { meetingId }).then((r) => { location.hash = '#/cs/notice/' + r.noticeId; }); },
    saveNote(noticeId) { act('notice.update', { noticeId, note: $('#noticeNote').value }, 'Saved'); },
    issueNotice(noticeId) {
      otpModal('Sign and issue notice', 'Your one-time code is your signature on this notice. Once issued it is sealed and cannot be changed.', 'issue:' + noticeId,
        (code) => act('notice.issue', { noticeId, code }, 'Notice issued by email and SMS'));
    },
    changeNotice(meetingId, kind) {
      const fields = kind === 'postponement' ? [{ name: 'newDate', label: 'New date', type: 'date', required: true }, { name: 'note', label: 'Reason (shown on the notice)', type: 'textarea' }]
        : kind === 'venue' ? [{ name: 'newVenue', label: 'New venue', required: true }, { name: 'note', label: 'Note', type: 'textarea' }]
        : [{ name: 'note', label: 'Note (add the extra items to the agenda first)', type: 'textarea' }];
      promptModal({ postponement: 'Postpone meeting', venue: 'Change venue', supplementary: 'Supplementary agenda' }[kind], fields,
        (v) => act('notice.change', Object.assign({ meetingId, kind }, v), 'Linked notice drafted').then((r) => { location.hash = '#/cs/notice/' + r.noticeId; }));
    },
    addItem(meetingId, f) {
      const v = Object.fromEntries(new FormData(f));
      act('agenda.add', Object.assign({ meetingId }, v), 'Item added');
    },
    removeItem(meetingId, itemId) { act('agenda.remove', { meetingId, itemId }, 'Item removed'); },
    join(meetingId, mode) { act('live.join', { meetingId, mode }, mode === 'virtual' ? 'You are marked as joining by video' : 'You are marked present'); },
    suggest(meetingId, itemId, el) { const text = el.value.trim(); if (!text) return; act('suggest.add', { meetingId, itemId, text }, 'Suggestion posted').then(() => { el.value = ''; }); },
    startMeeting(meetingId) { act('live.start', { meetingId }, 'Meeting started').then(() => { location.hash = '#/live/' + meetingId; }); },
    endMeeting(meetingId) {
      promptModal('End the meeting?', [], () => act('live.end', { meetingId }, 'Meeting ended. Minutes drafted.').then(() => { location.hash = '#/minutes/' + meetingId; }));
    },
    vote(meetingId, itemId, choice) { act('vote.cast', { meetingId, itemId, choice }, 'Vote recorded'); },
    saveDiscussion(meetingId, itemId) { const el = $('#disc-' + itemId); if (el) api('/api/action', { type: 'live.discussion', payload: { meetingId, itemId, text: el.value } }).catch((e) => toast(e.message, true)); },
    saveNotes(pid) { const el = $('#note-' + pid); if (el) api('/api/action', { type: 'note.save', payload: { paperId: pid, text: el.value } }).then(() => { S.notes[pid] = el.value; toast('Note saved'); }).catch((e) => toast(e.message, true)); },
    saveMinutes(meetingId) { act('minutes.edit', { meetingId, text: $('#minText').value }, 'Minutes saved'); },
    circulate(meetingId) {
      const t = $('#minText').value;
      api('/api/action', { type: 'minutes.edit', payload: { meetingId, text: t } }).then(() => act('minutes.circulate', { meetingId }, 'Circulated for signature')).catch((e) => toast(e.message, true));
    },
    signMinutes(meetingId) {
      otpModal('Sign the minutes', 'Your one-time code is your signature. When the Chair and the Company Secretary have both signed, the minutes are sealed and archived.', 'sign:' + meetingId,
        (code) => act('minutes.sign', { meetingId, code }, 'Minutes signed'));
    },
    createMeeting(f) {
      const v = Object.fromEntries(new FormData(f));
      act('meeting.create', { bodyId: v.bodyId, options: [v.d1, v.d2, v.d3], closesOn: v.closesOn, venue: v.venue, videoLink: v.videoLink, time: v.time }, 'Meeting created. Members can now answer the poll.')
        .then((r) => { location.hash = '#/meeting/' + r.meetingId; });
    },
    tempPassword,
    saveUser(id, f) {
      const v = Object.fromEntries(new FormData(f));
      const p = { name: v.name, title: v.title, email: v.email, mobile: v.mobile, username: v.username, voting: !!v.voting, bodies: S.bodies.filter((b) => v['body_' + b.id]).map((b) => b.id) };
      if (f.role && !f.role.disabled) p.role = v.role;
      if (!id) {
        p.password = v.password;
        act('user.create', p).then((r) => {
          location.hash = '#/cs/users';
          showInfo('User added', `<p>Give ${esc(v.name)} these sign-in details:</p><div class="sms"><small>Sign-in details</small>User ID <b>${esc(r.username)}</b><br>Temporary password <b>${esc(v.password)}</b></div><p class="faint">They will choose their own password the first time they sign in.</p>`);
        }).catch(() => {});
      } else act('user.update', Object.assign({ userId: id }, p), 'Saved').catch(() => {});
    },
    resetPassword(id) {
      const pw = tempPassword();
      const u = S.users.find((x) => x.id === id);
      promptModal(`Reset password for ${u.name}?`, [], () => act('user.resetPassword', { userId: id, password: pw }).then(() => {
        setTimeout(() => showInfo('Password reset', `<div class="sms"><small>New sign-in details</small>User ID <b>${esc(u.username)}</b><br>Temporary password <b>${esc(pw)}</b></div><p class="faint">${id === me().id ? 'Use it next time you sign in.' : 'They will choose their own password when they next sign in.'}</p>`), 50);
      }));
    },
    deactivate(id) {
      const u = S.users.find((x) => x.id === id);
      promptModal(`Deactivate ${u.name}?`, [], () => act('user.setActive', { userId: id, active: false }, 'User deactivated'));
    },
    async changePassword(f) {
      if (f.next.value !== f.again.value) return toast('The two new passwords do not match.', true);
      try {
        const d = await api('/api/password', { current: f.current.value, next: f.next.value });
        token = d.token; store.set('b360.token', token);
        await refresh(true); toast('Password saved'); location.hash = '#/home'; render();
      } catch (e) { toast(e.message, true); }
    },
    saveMember(userId) { act('member.update', { userId, email: $('#em-' + userId).value, mobile: $('#mo-' + userId).value }, 'Saved'); },
    rsearch(q) { try { sessionStorage.setItem('b360.rq', q); } catch (e) { /* ignore */ } const pos = q.length; render(); const el = document.querySelector('main input'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } },
    async ask(q) {
      try { const d = await api('/api/ask', { q }); lastAsk = Object.assign({ q }, d); render(); } catch (e) { toast(e.message, true); }
    },
    resetDemo() {
      promptModal('Reset all demo data?', [], async () => {
        await api('/api/demo/reset', {});
        await refresh(true);
        toast('Demo data reset'); location.hash = '#/home';
      });
    },
    ics(meetingId) {
      const m = meeting(meetingId);
      if (!m.date) return;
      const [h, mi] = (m.time || '11:00').split(':').map(Number);
      // Pakistan Standard Time is UTC+5 all year.
      const start = new Date(Date.UTC(...m.date.split('-').map((x, i) => i === 1 ? Number(x) - 1 : Number(x)), h - 5, mi));
      const end = new Date(start.getTime() + 3 * 3600000);
      const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Boardroom 360//EN', 'BEGIN:VEVENT', `UID:${m.id}@boardroom360`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(start)}`, `DTEND:${f(end)}`,
        `SUMMARY:${m.title}`, `LOCATION:${m.venue}`, `DESCRIPTION:${m.videoLink ? 'Video link: ' + m.videoLink : ''}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
      a.download = `${m.title.replace(/[^\w]+/g, '_')}.ics`;
      document.body.appendChild(a); a.click(); a.remove();
    },
  };

  // ---------------- start ----------------
  (async function start() {
    if (token) { try { pending = true; await refresh(true); } catch (e) { token = null; store.del('b360.token'); } finally { pending = false; } }
    render();
  })();
})();
