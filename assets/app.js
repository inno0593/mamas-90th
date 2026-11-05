(() => {
  'use strict';

  const NIGHTS = ['19', '20', '21', '22', '23', '24', '25', '26', '27'];
  // Values must match LODGING in backend/Code.gs.
  const LODGING = [
    { value: 'Tagaytay Big House', short: 'Big House', cls: 'L-bighouse' },
    { value: '73 Times', short: '73 Times', cls: 'L-73' },
    { value: 'Hillcreek', short: 'Hillcreek', cls: 'L-hill' },
    { value: 'QC hotel or other', short: 'QC hotel', cls: 'L-hotel' },
    { value: 'Other / own', short: 'Own', cls: 'L-own' },
    { value: 'Need lodging', short: 'Need', cls: 'L-need' },
    { value: 'Not needed', short: 'Not needed', cls: 'L-none' },
  ];
  const HOUSE_CAPACITY = 24;
  const EVENT_NIGHTS = { 21: 'Tagaytay', 22: 'Tagaytay', 23: 'Tagaytay', 25: 'Birthday' };
  const BIRTHDAY = Date.UTC(2027, 1, 24, 16, 0); // Feb 25, 2027, midnight in Manila
  const TEXT_FIELDS = ['name', 'contact', 'arrDate', 'arrTime', 'arrFlight', 'depDate', 'depTime', 'depFlight', 'otherNeeds', 'roomSharing', 'bedPref', 'notes'];
  const TRAVEL_FIELDS = ['arrDate', 'arrTime', 'arrFlight', 'depDate', 'depTime', 'depFlight'];
  const AVATAR_COLORS = ['#1d4339', '#3c5ba3', '#2a8584', '#7a4f9e', '#a24d3c', '#9a6b14', '#2f6b4f', '#5b4b8a'];

  const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);
  // Local preview always uses the dev server's fake sheet, never the real one.
  const API = isLocalDev ? '/api' : (window.SITE_CONFIG && window.SITE_CONFIG.apiUrl) || '';
  const PASSWORD_KEY = 'm90-password'; // also read by the inline script in index.html
  const AUTH_ERRORS = ['wrong_password', 'too_many_tries', 'password_not_set'];

  const state = { people: [], status: API ? 'loading' : 'closed', view: 'people', query: '', loadedAt: 0 };
  let editing = null;
  let dirty = false;
  let password = stored(() => localStorage.getItem(PASSWORD_KEY)) || '';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const board = $('#board');
  const dialog = $('#editor');
  const form = $('#form');
  const gate = $('#gate');
  const gateInput = $('#gate-password');

  // ---------- helpers ----------
  // localStorage can be missing or throw (private windows, blocked storage).
  function stored(fn) { try { return fn(); } catch { return null; } }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lodging = (v) => LODGING.find((l) => l.value === v);
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
  const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const isLocal = (p) => p.arrDate === 'n/a';

  function nightDate(d) { return new Date(2027, 1, Number(d)); }
  function fmtDate(iso) {
    if (!isISODate(iso)) return iso;
    const [y, m, d] = iso.split('-').map(Number);
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    if (y !== 2027) opts.year = 'numeric';
    return new Date(y, m - 1, d).toLocaleDateString('en-US', opts);
  }
  function fmtTime(t) {
    const m = /^(\d{2}):(\d{2})$/.exec(t || '');
    if (!m) return t || '';
    const h = Number(m[1]);
    return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
  }
  function fmtUpdated(s) {
    if (!s) return '';
    const iso = s.slice(0, 10);
    if (!isISODate(iso)) return s;
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function initials(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function avatarColor(name) {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  function isEmpty(p) {
    return !['tagaytay', 'feb25', ...TRAVEL_FIELDS, 'otherNeeds', 'roomSharing', 'bedPref', 'notes', ...NIGHTS.map((d) => 'n' + d)].some((k) => p[k]);
  }
  function hasPlans(p) {
    return TRAVEL_FIELDS.some((k) => p[k]) || NIGHTS.some((d) => p['n' + d]);
  }

  // ---------- data ----------
  // Every call is a POST with the password in the body. A plain string body is sent as
  // text/plain, which keeps the browser from sending a CORS preflight Apps Script can't answer.
  async function request(body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(API, { method: 'POST', body: JSON.stringify({ ...body, password }), cache: 'no-store', signal: ctrl.signal });
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  const list = () => request({ action: 'list' });

  function setPeople(people) {
    state.people = people;
    state.status = 'ready';
    state.loadedAt = Date.now();
  }

  async function load({ quiet = false } = {}) {
    if (!API) return render();
    if (!quiet) { state.status = 'loading'; render(); }
    try {
      const data = await list();
      if (!data.ok && AUTH_ERRORS.includes(data.error)) return lock(data.error === 'wrong_password' ? 'again' : data.error);
      if (!data.ok) throw new Error(data.error || 'load_failed');
      setPeople(data.people);
    } catch (err) {
      console.error(err);
      if (!quiet || state.status !== 'ready') state.status = 'error';
    }
    render();
  }

  // ---------- password screen ----------
  const GATE_MESSAGES = {
    again: 'Please enter the family password again.',
    wrong_password: "That's not it. Check the spelling and try again.",
    too_many_tries: 'Too many wrong tries. Wait 10 minutes, then try again.',
    password_not_set: "The password hasn't been set up yet. Please try again later.",
    offline: "Couldn't connect. Check your internet and try again.",
    failed: 'Something went wrong. Please try again.',
  };

  function setGateError(reason) {
    $('#gate-error').textContent = GATE_MESSAGES[reason] || '';
    if (reason === 'wrong_password') gateInput.setAttribute('aria-invalid', 'true');
    else gateInput.removeAttribute('aria-invalid');
    if (reason === 'wrong_password' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const card = $('.gate__card', gate);
      card.classList.remove('is-wrong');
      void card.offsetWidth; // restart the shake
      card.classList.add('is-wrong');
    }
  }

  function lock(reason) {
    password = '';
    // Only forget a saved password that was actually wrong, not one blocked by the lockout.
    if (reason === 'again') stored(() => localStorage.removeItem(PASSWORD_KEY));
    state.people = [];
    state.status = 'loading';
    document.documentElement.classList.add('is-locked');
    setGateError(reason);
    // Skip autofocus on phones so the keyboard doesn't cover the screen straight away.
    if (matchMedia('(hover: hover)').matches) gateInput.focus();
  }

  function unlock() {
    document.documentElement.classList.remove('is-locked');
    window.scrollTo(0, 0);
    render();
  }

  async function enter(e) {
    e.preventDefault();
    const value = gateInput.value.trim();
    if (!value) { setGateError(''); gateInput.focus(); return; }
    const btn = $('#gate-submit');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    password = value;
    try {
      const data = await list();
      if (data.ok) {
        stored(() => localStorage.setItem(PASSWORD_KEY, value));
        setPeople(data.people);
        gateInput.value = '';
        setGateError('');
        unlock();
      } else {
        password = '';
        setGateError(AUTH_ERRORS.includes(data.error) ? data.error : 'failed');
        gateInput.select();
      }
    } catch (err) {
      console.error(err);
      password = '';
      setGateError('offline');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Come in';
    }
  }

  // ---------- rendering ----------
  function render() {
    renderStats();
    renderBoard();
    $$('[data-action="add"]').forEach((b) => { b.disabled = state.status !== 'ready'; });
  }

  function renderStats() {
    const el = $('#stats');
    if (state.status !== 'ready') { el.innerHTML = ''; return; }
    const ppl = state.people;
    const count = (k, v) => ppl.filter((p) => p[k] === v).length;
    const todo = ppl.filter((p) => !p.tagaytay && !p.feb25).length;
    const maybe = (n) => (n ? ` <small>+${n} maybe</small>` : '');
    el.innerHTML = `
      <div class="stat"><strong>${ppl.length}</strong><span>People on the list</span></div>
      <div class="stat"><strong>${count('tagaytay', 'Yes')}${maybe(count('tagaytay', 'Maybe'))}</strong><span>Going to Tagaytay</span></div>
      <div class="stat"><strong>${count('feb25', 'Yes')}${maybe(count('feb25', 'Maybe'))}</strong><span>At the birthday, Feb 25</span></div>
      <div class="stat ${todo ? 'stat--alert' : ''}"><strong>${todo}</strong><span>Still need to reply</span></div>`;
  }

  function filtered() {
    const q = fold(state.query.trim());
    if (!q) return state.people;
    return state.people.filter((p) => fold(p.name).includes(q) || fold(p.contact).includes(q));
  }

  function renderBoard() {
    if (state.status === 'closed') {
      board.innerHTML = `<div class="notice"><h3>Sign-ups open soon</h3><p>We're getting the sign-up sheet ready. Check back shortly.</p></div>`;
      return;
    }
    if (state.status === 'loading') {
      board.innerHTML = `<div class="people">${'<div class="skeleton"></div>'.repeat(6)}</div>`;
      return;
    }
    if (state.status === 'error') {
      board.innerHTML = `<div class="notice"><h3>Couldn't load the sign-up list</h3><p>Check your connection and try again.</p><button class="btn btn--dark" type="button" data-action="retry">Try again</button></div>`;
      return;
    }
    const list = filtered();
    if (!list.length) {
      board.innerHTML = `<div class="empty-state"><p>No one matches "${esc(state.query)}".</p><button class="btn btn--dark" type="button" data-action="add">Add ${esc(state.query)}</button></div>`;
      return;
    }
    if (state.view === 'nights') board.innerHTML = nightsView(list);
    else if (state.view === 'flights') board.innerHTML = flightsView(list);
    else board.innerHTML = `<div class="people">${list.map(personCard).join('')}</div>`;
  }

  function chip(label, value) {
    return `<span class="chip chip--${value || 'blank'}">${label} · ${esc(value || '—')}</span>`;
  }

  function tripLine(date, time, flight) {
    if (!date && !time && !flight) return 'TBD';
    return [date ? fmtDate(date) : 'Date TBD', fmtTime(time), flight].filter(Boolean).map(esc).join(' · ');
  }

  function personCard(p) {
    const empty = isEmpty(p);
    const sub = p.name.trim().toLowerCase() === 'mama' ? 'The birthday girl 🎂'
      : p.contact && p.contact !== p.name ? `Contact: ${esc(p.contact)}`
      : empty ? 'No plans added yet' : '';
    const top = `
      <div class="person__top">
        <span class="avatar" style="background:${avatarColor(p.name)}" aria-hidden="true">${esc(initials(p.name))}</span>
        <div><h3 class="person__name">${esc(p.name)}</h3>${sub ? `<p class="person__sub">${sub}</p>` : ''}</div>
        <button type="button" class="person__edit" data-edit="${esc(p.id)}" aria-label="${empty ? 'Add plans for' : 'Edit plans for'} ${esc(p.name)}">${empty ? 'Add plans' : 'Edit'}</button>
      </div>`;
    if (empty) return `<article class="person person--empty" data-id="${esc(p.id)}">${top}</article>`;

    const trip = isLocal(p)
      ? `<dl class="trip"><div><dt>Travel</dt><dd>Already in the Philippines</dd></div></dl>`
      : TRAVEL_FIELDS.some((k) => p[k])
        ? `<dl class="trip">
            <div><dt>Arrives</dt><dd>${tripLine(p.arrDate, p.arrTime, p.arrFlight)}</dd></div>
            <div><dt>Leaves</dt><dd>${tripLine(p.depDate, p.depTime, p.depFlight)}</dd></div>
          </dl>`
        : '';
    const strip = NIGHTS.some((d) => p['n' + d])
      ? `<div class="strip" role="img" aria-label="Lodging by night: ${esc(NIGHTS.map((d) => `Feb ${d} ${p['n' + d] || 'not set'}`).join(', '))}">
          ${NIGHTS.map((d) => { const l = lodging(p['n' + d]); return `<i ${l ? `class="${l.cls}"` : ''} title="Feb ${d}: ${esc(p['n' + d] || 'not set')}"></i>`; }).join('')}
        </div><div class="strip__legend"><span>Feb 19</span><span>where they sleep</span><span>Feb 27</span></div>`
      : '';
    const extras = [['Sharing with', p.roomSharing], ['Bed', p.bedPref], ['Other dates', p.otherNeeds], ['Notes', p.notes]]
      .filter(([, v]) => v).map(([k, v]) => `<b>${k}:</b> ${esc(v)}`).join('<br>');

    return `<article class="person" data-id="${esc(p.id)}">
      ${top}
      <div class="chips">${chip('Tagaytay', p.tagaytay)}${chip('Feb 25', p.feb25)}</div>
      ${trip}${strip}
      ${extras ? `<p class="person__notes">${extras}</p>` : ''}
      ${p.updated ? `<p class="person__foot">Updated ${esc(fmtUpdated(p.updated))}</p>` : ''}
    </article>`;
  }

  function nightsView(list) {
    const head = NIGHTS.map((d) => {
      const date = nightDate(d);
      const ev = EVENT_NIGHTS[d];
      return `<th class="${ev === 'Tagaytay' ? 'ev-t' : ev ? 'ev-b' : ''}">${date.toLocaleDateString('en-US', { weekday: 'short' })} ${d}<small>${ev || '&nbsp;'}</small></th>`;
    }).join('');
    const evCls = (d) => (EVENT_NIGHTS[d] === 'Tagaytay' ? 'ev-t' : EVENT_NIGHTS[d] ? 'ev-b' : '');
    const rows = list.map((p) => `<tr data-id="${esc(p.id)}"><td class="name">${esc(p.name)}</td>${NIGHTS.map((d) => {
      const l = lodging(p['n' + d]);
      return `<td class="${evCls(d)}">${l ? `<span class="pill ${l.cls}">${l.short}</span>` : '<span class="pill pill--blank">·</span>'}</td>`;
    }).join('')}</tr>`).join('');

    // Totals always cover everyone, not just the search results.
    const totals = LODGING.map((l) => {
      const counts = NIGHTS.map((d) => state.people.filter((p) => p['n' + d] === l.value).length);
      if (!counts.some(Boolean) && l.value !== 'Need lodging' && l.value !== 'Tagaytay Big House') return '';
      const cells = counts.map((c) => {
        if (l.value === 'Tagaytay Big House') return `<td class="${c > HOUSE_CAPACITY ? 'over' : c ? '' : 'zero'}">${c}<span class="cap">/${HOUSE_CAPACITY}</span></td>`;
        return `<td class="${c ? '' : 'zero'}">${c}</td>`;
      }).join('');
      return `<tr class="${l.value === 'Need lodging' ? 'need' : ''}"><td>${esc(l.value)}</td>${cells}</tr>`;
    }).join('');

    return `<ul class="legend">${LODGING.map((l) => `<li class="${l.cls}">${esc(l.value)}</li>`).join('')}</ul>
      <div class="table-wrap table-wrap--totals"><table class="nights-table">
        <thead><tr><th>Totals, everyone</th>${head}</tr></thead>
        <tfoot>${totals}</tfoot>
      </table></div>
      <div class="table-wrap"><table class="nights-table">
        <thead><tr><th>Night of Feb…</th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function flightsView(list) {
    const travellers = list.filter((p) => !isLocal(p));
    const local = list.filter(isLocal);
    const column = (title, icon, dateKey, timeKey, flightKey) => {
      const dated = travellers.filter((p) => isISODate(p[dateKey]))
        .sort((a, b) => (a[dateKey] + (a[timeKey] || '99')).localeCompare(b[dateKey] + (b[timeKey] || '99')));
      const unknown = travellers.filter((p) => !isISODate(p[dateKey]));
      let html = '';
      let lastDay = '';
      for (const p of dated) {
        if (p[dateKey] !== lastDay) { lastDay = p[dateKey]; html += `<p class="flight-day">${esc(fmtDate(lastDay))}</p>`; }
        html += `<div class="flight" data-id="${esc(p.id)}"><span class="flight__time">${esc(fmtTime(p[timeKey]) || '—')}</span>
          <span><span class="flight__who">${esc(p.name)}</span><span class="flight__info">${esc(p[flightKey] || 'Flight TBD')}</span></span></div>`;
      }
      if (!dated.length) html += `<p class="flight-none">No dates yet.</p>`;
      if (unknown.length) html += `<p class="flight-day">Date not set yet</p><p class="flight-none">${unknown.map((p) => esc(p.name)).join(', ')}</p>`;
      return `<div class="flight-col"><h3>${icon}${title}</h3>${html}</div>`;
    };
    // Lucide "plane-landing" / "plane-takeoff" icons (ISC licence).
    const landing = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 22h20"/><path d="M3.77 10.77 2 9l2-4.5 1.1.55c.55.28.9.84.9 1.45s.35 1.17.9 1.45L8 8.5l3-6 1.05.53a2 2 0 0 1 1.09 1.52l.72 5.4a2 2 0 0 0 1.09 1.52l4.4 2.2c.42.22.78.55 1.01.96l.6 1.03c.49.88-.06 1.98-1.06 2.1l-1.18.15c-.47.06-.95-.02-1.37-.24L4.29 11.15a2 2 0 0 1-.52-.38Z"/></svg>';
    const takeoff = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 22h20"/><path d="M6.36 17.4 4 17l-2-4 1.1-.55a2 2 0 0 1 1.8 0l.17.1a2 2 0 0 0 1.8 0L8 12 5 6l.9-.45a2 2 0 0 1 2.09.2l4.02 3a2 2 0 0 0 2.1.2l4.19-2.06a2.41 2.41 0 0 1 1.73-.17L21 7a1.4 1.4 0 0 1 .87 1.99l-.38.76c-.23.46-.6.84-1.07 1.08L7.58 17.2a2 2 0 0 1-1.22.18Z"/></svg>';
    return `<div class="flights">
      ${column('Arrivals', landing, 'arrDate', 'arrTime', 'arrFlight')}
      ${column('Departures', takeoff, 'depDate', 'depTime', 'depFlight')}
    </div>
    ${local.length ? `<p class="hint" style="margin-top:14px">Already in the Philippines: ${local.map((p) => esc(p.name)).join(', ')}</p>` : ''}`;
  }

  function renderWeek() {
    $('#week').innerHTML = NIGHTS.map((d) => {
      const ev = EVENT_NIGHTS[d];
      const cls = ev === 'Tagaytay' ? 'day--tagaytay' : ev ? 'day--bday' : '';
      return `<li class="day ${cls}"><small>${nightDate(d).toLocaleDateString('en-US', { weekday: 'short' })}</small><strong>${d}</strong><em>${ev ? (ev === 'Birthday' ? 'Mama turns 90' : ev) : '&nbsp;'}</em></li>`;
    }).join('');
  }

  function renderCountdown() {
    const el = $('#countdown');
    const ms = BIRTHDAY - Date.now();
    if (ms <= 0) {
      el.classList.add('countdown--done');
      el.innerHTML = `<div class="countdown__item"><strong>Happy 90th, Mama!</strong><span>Maligayang kaarawan</span></div>`;
      return;
    }
    const s = Math.floor(ms / 1000);
    const parts = [[Math.floor(s / 86400), 'days'], [Math.floor(s / 3600) % 24, 'hours'], [Math.floor(s / 60) % 60, 'min'], [s % 60, 'sec']];
    el.innerHTML = parts.map(([n, l]) => `<div class="countdown__item"><strong>${n}</strong><span>${l}</span></div>`).join('')
      + `<p class="countdown__note">until Mama's birthday, Thursday Feb 25, 2027</p>`;
  }

  // ---------- editor ----------
  function buildNightRows() {
    const opts = `<option value="">Not sure yet</option>${LODGING.map((l) => `<option value="${esc(l.value)}">${esc(l.value)}</option>`).join('')}`;
    $('#nights').innerHTML = NIGHTS.map((d) => {
      const date = nightDate(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const ev = EVENT_NIGHTS[d];
      return `<div class="night" data-night="${d}">
        <span class="night__label">${date}<small>${ev ? (ev === 'Birthday' ? 'Birthday night' : 'Tagaytay') : 'Night'}</small></span>
        <label class="field"><span class="sr-only">Night of ${date}</span><select name="n${d}">${opts}</select></label>
      </div>`;
    }).join('');
    $('#set-all').insertAdjacentHTML('beforeend', LODGING.map((l) => `<option value="${esc(l.value)}">${esc(l.value)}</option>`).join(''));
  }

  function paintNight(select) {
    const row = select.closest('.night');
    const l = lodging(select.value);
    LODGING.forEach((x) => row.classList.remove(x.cls));
    if (l) row.classList.add(l.cls);
  }

  function setRadio(name, value) {
    $$(`input[name="${name}"]`, form).forEach((r) => { r.checked = r.value === value; });
  }

  function fillForm(p) {
    for (const k of TEXT_FIELDS) form.elements[k].value = p[k] && p[k] !== 'n/a' ? p[k] : '';
    setRadio('tagaytay', p.tagaytay || '');
    setRadio('feb25', p.feb25 || '');
    for (const d of NIGHTS) { const s = form.elements['n' + d]; s.value = p['n' + d] || ''; paintNight(s); }
    $('#local').checked = isLocal(p);
    syncLocal();
  }

  function readForm() {
    const p = {};
    for (const k of TEXT_FIELDS) p[k] = form.elements[k].value.trim();
    p.tagaytay = ($('input[name="tagaytay"]:checked', form) || {}).value || '';
    p.feb25 = ($('input[name="feb25"]:checked', form) || {}).value || '';
    for (const d of NIGHTS) p['n' + d] = form.elements['n' + d].value;
    if ($('#local').checked) {
      for (const k of TRAVEL_FIELDS) p[k] = '';
      p.arrDate = 'n/a';
      p.depDate = 'n/a';
    }
    return p;
  }

  function syncLocal() {
    $('#travel-fields').hidden = $('#local').checked;
  }

  function fillCopyOptions(exceptId) {
    const sel = $('#copy-from');
    const others = state.people.filter((p) => p.id !== exceptId && hasPlans(p)).sort((a, b) => a.name.localeCompare(b.name));
    sel.innerHTML = `<option value="">Copy dates &amp; lodging from…</option>${others.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}`;
    sel.closest('.field').hidden = !others.length;
  }

  function openEditor(person) {
    editing = person || null;
    form.reset();
    $('#form-error').textContent = '';
    form.elements.name.removeAttribute('aria-invalid');
    $('#editor-title').textContent = person ? person.name : 'Add someone';
    $('#editor-kicker').textContent = person ? 'Travel & lodging plans' : 'New person';
    fillForm(person || {});
    if (!person) form.elements.name.value = state.query.trim();
    fillCopyOptions(person && person.id);
    dirty = false;
    dialog.showModal();
    $('.sheet__body', dialog).scrollTop = 0;
    if (!person) form.elements.name.focus();
    else $('.icon-btn', dialog).focus();
  }

  function closeEditor(force) {
    if (!force && dirty && !confirm('Discard your changes?')) return false;
    dialog.close();
    editing = null;
    return true;
  }

  async function save(e) {
    e.preventDefault();
    const err = $('#form-error');
    const person = readForm();
    if (!person.name) {
      form.elements.name.setAttribute('aria-invalid', 'true');
      form.elements.name.focus();
      err.textContent = 'Please add a name.';
      return;
    }
    form.elements.name.removeAttribute('aria-invalid');
    const btn = $('#save');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    err.textContent = '';
    // `base` lets the backend refuse the save if someone changed this person since we loaded them.
    const payload = { action: 'save', person: { ...person, id: editing ? editing.id : '' }, base: editing || undefined };
    try {
      const r = await request(payload);
      if (r.ok) {
        setPeople(r.people);
        closeEditor(true);
        render();
        toast(`Saved! Thanks, ${firstName(r.person.name)} 🎉`);
        confetti();
        flash(r.person.id);
      } else if (r.error === 'conflict') {
        const i = state.people.findIndex((p) => p.id === r.person.id);
        if (i >= 0) state.people[i] = r.person;
        editing = r.person;
        fillForm(r.person);
        dirty = false;
        render();
        err.textContent = 'Someone else just updated this entry, so we loaded their version. Make your changes again and save.';
      } else if (AUTH_ERRORS.includes(r.error)) {
        // The password was changed while this page was open. Keep their edits on screen.
        err.textContent = r.error === 'too_many_tries'
          ? "Couldn't save: too many wrong passwords were tried just now. Wait 10 minutes and save again."
          : "Couldn't save: the family password has changed. Copy anything you typed, then reload the page.";
      } else {
        err.textContent = r.error === 'name_required' ? 'Please add a name.' : "Couldn't save. Please try again.";
      }
    } catch (ex) {
      console.error(ex);
      err.textContent = "Couldn't save. Check your connection and try again.";
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save plans';
    }
  }

  function flash(id) {
    const card = board.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card.classList.add('is-flash');
    setTimeout(() => card.classList.remove('is-flash'), 2200);
  }

  // ---------- toast + confetti ----------
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 3200);
  }

  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = document.createElement('div');
    box.className = 'confetti';
    const colors = ['#e3bd6a', '#c99a3e', '#f6e4b5', '#2f7a55', '#d6563a', '#3c5ba3', '#ffffff'];
    for (let i = 0; i < 90; i++) {
      const c = document.createElement('i');
      c.style.left = `${Math.random() * 100}%`;
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--x', `${(Math.random() - 0.5) * 220}px`);
      c.style.setProperty('--r', `${(Math.random() - 0.5) * 1080}deg`);
      c.style.setProperty('--d', `${1.6 + Math.random() * 1.6}s`);
      c.style.animationDelay = `${Math.random() * 0.35}s`;
      box.appendChild(c);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 4000);
  }

  // ---------- events ----------
  function personById(id) { return state.people.find((p) => p.id === id); }

  document.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]');
    if (action) {
      const a = action.dataset.action;
      if (a === 'add') openEditor(null);
      else if (a === 'retry') load();
      else if (a === 'close') closeEditor(false);
      else if (a === 'my-info') {
        $('#signup').scrollIntoView({ behavior: 'smooth' });
        setTimeout(() => $('#search').focus({ preventScroll: true }), 500);
      }
      return;
    }
    const target = e.target.closest('[data-edit], #board [data-id]');
    if (target && board.contains(target)) {
      const p = personById(target.dataset.edit || target.dataset.id);
      if (p) openEditor(p);
    }
  });

  $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
    state.view = tab.dataset.view;
    $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    renderBoard();
  }));

  $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderBoard(); });

  form.addEventListener('submit', save);
  $('#gate-form').addEventListener('submit', enter);
  $('#gate-show').addEventListener('click', (e) => {
    const show = gateInput.type === 'password';
    gateInput.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Hide' : 'Show';
    e.currentTarget.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    gateInput.focus();
  });
  gateInput.addEventListener('input', () => { if (gateInput.hasAttribute('aria-invalid')) setGateError(''); });
  form.addEventListener('input', () => { dirty = true; });
  form.addEventListener('change', (e) => {
    dirty = true;
    if (e.target.matches('#nights select')) paintNight(e.target);
  });
  $('#local').addEventListener('change', syncLocal);
  $('#set-all').addEventListener('change', (e) => {
    const v = e.target.value;
    if (!v) return;
    for (const d of NIGHTS) { const s = form.elements['n' + d]; s.value = v; paintNight(s); }
    e.target.value = '';
  });
  $('#copy-from').addEventListener('change', (e) => {
    const src = personById(e.target.value);
    e.target.value = '';
    if (!src) return;
    for (const k of TRAVEL_FIELDS) form.elements[k].value = src[k] && src[k] !== 'n/a' ? src[k] : '';
    for (const d of NIGHTS) { const s = form.elements['n' + d]; s.value = src['n' + d] || ''; paintNight(s); }
    if (src.tagaytay) setRadio('tagaytay', src.tagaytay);
    if (src.feb25) setRadio('feb25', src.feb25);
    $('#local').checked = isLocal(src);
    syncLocal();
    toast(`Copied ${firstName(src.name)}'s plans. Change anything that's different.`);
  });
  dialog.addEventListener('cancel', (e) => {
    if (dirty && !confirm('Discard your changes?')) e.preventDefault();
    else editing = null;
  });

  // Pick up other people's changes when someone comes back to the tab.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.status === 'ready' && !dialog.open && Date.now() - state.loadedAt > 30000) {
      load({ quiet: true });
    }
  });

  buildNightRows();
  renderWeek();
  renderCountdown();
  setInterval(renderCountdown, 1000);
  if (API && !password) lock('');
  else { document.documentElement.classList.remove('is-locked'); load(); }
})();
