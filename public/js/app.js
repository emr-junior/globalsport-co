(function () {
  'use strict';
  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  function el(tag, attrs, text) { var e = document.createElement(tag); if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]); if (text) e.textContent = text; return e; }
  function api(url, method, body) {
    var o = { method: method || 'GET', headers: { 'x-csrf-token': csrf }, credentials: 'same-origin' };
    if (body !== undefined) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(body); }
    return fetch(url, o).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }
  function cookie(n) { var m = document.cookie.match('(?:^|; )' + n + '=([^;]*)'); return m ? decodeURIComponent(m[1]) : null; }

  /* ---- consent & optional analytics (nothing non-essential loads before consent) ---- */
  function loadAnalytics() {
    var m = document.querySelector('meta[name="analytics-src"]');
    if (m && cookie('gs_consent') === 'a1' && !document.getElementById('gs-analytics')) { var s = el('script', { src: m.content, async: '', id: 'gs-analytics' }); document.head.appendChild(s); }
  }
  var banner = document.getElementById('consent-banner');
  if (banner && !cookie('gs_consent')) banner.hidden = false;
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-consent]'); if (!b) return;
    var accept = b.getAttribute('data-consent') === 'accept';
    api('/consent', 'POST', { analytics: accept }).then(function () { if (banner) banner.hidden = true; if (accept) loadAnalytics(); else { var s = document.getElementById('gs-analytics'); if (s) s.remove(); } });
  });
  loadAnalytics();

  /* ---- search suggestions ---- */
  var q = document.getElementById('q'), dl = document.getElementById('suggestions'), t;
  if (q && dl) q.addEventListener('input', function () {
    clearTimeout(t); var v = q.value.trim(); if (v.length < 2) return;
    t = setTimeout(function () { fetch('/api/suggest?q=' + encodeURIComponent(v)).then(function (r) { return r.json(); }).then(function (rows) { dl.textContent = ''; rows.forEach(function (x) { dl.appendChild(el('option', { value: x.name })); }); }).catch(function () {}); }, 200);
  });

  /* ---- quick view dialog ---- */
  var qd = document.getElementById('quick-dialog');
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.quick-view');
    if (b && qd && qd.showModal) {
      fetch('/quick/' + encodeURIComponent(b.getAttribute('data-slug'))).then(function (r) { return r.text(); }).then(function (h) { qd.innerHTML = h; qd.showModal(); var c = qd.querySelector('.close-dialog'); if (c) c.focus(); });
    }
    if (e.target.closest('.close-dialog') && qd) qd.close();
  });

  /* ---- widget factory ---- */
  function widget(id, title, opener) {
    var w = el('section', { id: id, class: 'widget', role: 'dialog', 'aria-labelledby': id + '-t', hidden: '' });
    var head = el('header'); head.appendChild(el('h2', { id: id + '-t' }, title));
    var close = el('button', { type: 'button', class: 'btn' }, 'Close'); head.appendChild(close);
    var body = el('div', { class: 'widget-body', tabindex: '0', role: 'log', 'aria-live': 'polite' });
    w.appendChild(head); w.appendChild(body); document.body.appendChild(w);
    function open() { w.hidden = false; var f = w.querySelector('textarea,input'); (f || close).focus(); if (w.onopen) w.onopen(); }
    function shut() { w.hidden = true; if (w.onclose) w.onclose(); opener.focus(); }
    opener.addEventListener('click', open); close.addEventListener('click', shut);
    w.addEventListener('keydown', function (e) { if (e.key === 'Escape') shut(); });
    return { w: w, body: body, open: open };
  }
  function addMsg(body, cls, who, text) { var m = el('div', { class: 'msg ' + cls }); if (who) m.appendChild(el('span', { class: 'who' }, who)); m.appendChild(document.createTextNode(text)); body.appendChild(m); body.scrollTop = body.scrollHeight; return m; }

  /* ---- live chat (polling) ---- */
  var chatBtn = document.getElementById('open-chat');
  if (chatBtn) {
    var C = widget('chat', 'Live chat with support', chatBtn), last = 0, poll = null, active = false;
    var form = el('form', { novalidate: '' });
    var name = el('input', { type: 'text', id: 'chat-name', placeholder: 'Your name (optional)', 'aria-label': 'Your name (optional)', maxlength: '60', autocomplete: 'name' });
    var msg = el('textarea', { id: 'chat-msg', rows: '2', maxlength: '1000', 'aria-label': 'Message', placeholder: 'Type your message' });
    var send = el('button', { type: 'submit', class: 'btn' }, 'Send'); var rep = el('button', { type: 'button', class: 'btn btn-secondary' }, 'Report a problem');
    var note = el('p', { class: 'small', role: 'status' }, 'Do not share payment card details in chat.');
    form.appendChild(name); form.appendChild(msg); form.appendChild(send); form.appendChild(document.createTextNode(' ')); form.appendChild(rep); form.appendChild(note); C.w.appendChild(form);
    function offlineForm() {
      form.hidden = true; C.body.textContent = '';
      addMsg(C.body, 'msg-sys', '', 'No support agent is online right now. Leave an enquiry and we will reply by email.');
      var f = el('form'); var n = el('input', { type: 'text', 'aria-label': 'Your name', placeholder: 'Your name', maxlength: '80', autocomplete: 'name' }), em = el('input', { type: 'email', 'aria-label': 'Your email', placeholder: 'Your email', autocomplete: 'email' }), m2 = el('textarea', { rows: '3', 'aria-label': 'Your message', placeholder: 'Your message', maxlength: '1500' });
      var cb = el('input', { type: 'checkbox', id: 'oc' }), lb = el('label', { for: 'oc' }, ' I agree that GlobalSport Co. may use these details to reply to my enquiry.');
      var sb = el('button', { type: 'submit', class: 'btn' }, 'Send enquiry'), st = el('p', { role: 'status' });
      [n, em, m2, cb, lb, el('br'), sb, st].forEach(function (x) { f.appendChild(x); }); C.body.appendChild(f);
      f.addEventListener('submit', function (e) { e.preventDefault(); api('/api/chat/offline', 'POST', { name: n.value, email: em.value, message: m2.value, consent: cb.checked }).then(function (r) { st.textContent = r.ok ? 'Thank you. We will reply by email.' : (r.error || 'Could not send.'); if (r.ok) f.reset(); }); });
    }
    function tick() { api('/api/chat/messages?since=' + last).then(function (r) { if (r._status === 404) { active = false; return; } (r.messages || []).forEach(function (m) { last = Math.max(last, m.id); addMsg(C.body, m.sender === 'customer' ? 'msg-me' : m.sender === 'agent' ? 'msg-them' : 'msg-sys', m.sender === 'customer' ? 'You' : m.sender === 'agent' ? 'Support' : '', m.body); }); if (r.closed) { note.textContent = 'This conversation has ended.'; active = false; clearInterval(poll); } }); }
    C.w.onopen = function () {
      if (C.w.dataset.init) return; C.w.dataset.init = '1'; addMsg(C.body, 'msg-sys', '', 'You are chatting with a human support agent when one is available. For automated help use the AI assistant.');
      api('/api/chat/status').then(function (s) { if (s.conversation) { active = true; tick(); poll = setInterval(tick, 4000); } else if (!s.agentOnline) offlineForm(); });
    };
    form.addEventListener('submit', function (e) {
      e.preventDefault(); var text = msg.value.trim(); if (!text) return;
      if (!active) { api('/api/chat/start', 'POST', { name: name.value, message: text }).then(function (r) { if (r.offline) return offlineForm(); if (r.error) { note.textContent = r.error; return; } active = true; msg.value = ''; last = 0; C.body.textContent = ''; tick(); poll = setInterval(tick, 4000); }); }
      else api('/api/chat/send', 'POST', { body: text }).then(function (r) { if (r.error) note.textContent = r.error; else { msg.value = ''; tick(); } });
    });
    rep.addEventListener('click', function () { api('/api/chat/report', 'POST', {}).then(function (r) { note.textContent = r.ok ? 'Reported. Thank you.' : 'Start a chat first.'; }); });
  }

  /* ---- AI assistant ---- */
  var aiBtn = document.getElementById('open-ai');
  if (aiBtn) {
    var A = widget('ai', 'AI shopping assistant', aiBtn); var consented = false;
    var intro = el('p', { class: 'small' }, 'This is an AI assistant powered by Anthropic. It can make mistakes and cannot see your orders. If you opt in, your question (with email addresses and phone numbers removed) and relevant product and policy information are sent to Anthropic to generate an answer. Do not type personal or payment details. You can use live chat or the contact page instead at any time.');
    var cbox = el('input', { type: 'checkbox', id: 'ai-consent' }), clab = el('label', { for: 'ai-consent' }, ' I agree to my questions being sent to Anthropic to generate answers (optional).');
    var cwrap = el('div'); cwrap.appendChild(intro); cwrap.appendChild(cbox); cwrap.appendChild(clab); A.body.appendChild(cwrap);
    var f2 = el('form', { novalidate: '' }), q2 = el('textarea', { rows: '2', maxlength: '500', 'aria-label': 'Ask the AI assistant', placeholder: 'Ask about products, discounts, shipping, returns...' });
    var s2 = el('button', { type: 'submit', class: 'btn' }, 'Ask'), h2 = el('a', { class: 'btn btn-secondary', href: '/contact' }, 'Talk to a human'); var st2 = el('p', { role: 'status', class: 'small' });
    f2.appendChild(q2); f2.appendChild(s2); f2.appendChild(document.createTextNode(' ')); f2.appendChild(h2); f2.appendChild(st2); A.w.appendChild(f2);
    function setConsent(v) { consented = v; q2.disabled = !v; s2.disabled = !v; cbox.checked = v; }
    setConsent(false);
    A.w.onopen = function () { api('/api/ai/status').then(function (s) { if (s.consent) setConsent(true); if (!s.available) st2.textContent = 'The AI assistant is not currently configured; you can still browse and use live chat.'; }); };
    cbox.addEventListener('change', function () { api('/api/ai/consent', 'POST', { granted: cbox.checked }).then(function (r) { setConsent(!!r.consent); }); });
    f2.addEventListener('submit', function (e) {
      e.preventDefault(); var text = q2.value.trim(); if (!text || !consented) return;
      addMsg(A.body, 'msg-me', 'You', text); q2.value = ''; st2.textContent = 'AI is thinking...';
      api('/api/ai/ask', 'POST', { message: text }).then(function (r) {
        st2.textContent = '';
        if (r.error === 'consent_required') { setConsent(false); return; }
        if (r.error) { addMsg(A.body, 'msg-sys', '', r.error); return; }
        addMsg(A.body, 'msg-them', 'AI assistant', r.text);
        (r.products || []).forEach(function (p) { var a = el('a', { href: '/p/' + encodeURIComponent(p.slug) }, p.name); var d = el('div', { class: 'msg msg-sys' }); d.appendChild(a); A.body.appendChild(d); });
        if (r.escalate) { var d2 = el('div', { class: 'msg msg-sys' }); d2.appendChild(document.createTextNode('Need a person? ')); d2.appendChild(el('a', { href: '/contact' }, 'Contact support')); A.body.appendChild(d2); }
      }).catch(function () { st2.textContent = 'The assistant is unavailable. Please use live chat or the contact page.'; });
    });
  }

  /* ---- admin: image upload ---- */
  var up = document.getElementById('img-upload');
  if (up) up.addEventListener('click', function () {
    var f = document.getElementById('img-file').files[0], alt = document.getElementById('img-alt').value.trim(), st = document.getElementById('img-status'), id = document.getElementById('upload-box').dataset.product;
    if (!f || !alt) { st.textContent = 'Choose a file and enter alternative text.'; return; }
    if (f.size > 1048576) { st.textContent = 'File is larger than 1 MB.'; return; }
    fetch('/admin/products/' + id + '/image', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': f.type, 'x-csrf-token': csrf, 'x-alt': encodeURIComponent(alt) }, body: f })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (r) { st.textContent = r.ok ? 'Uploaded. Reload the page to see it.' : (r.j.error || 'Upload failed.'); });
  });

  /* ---- admin: support console ---- */
  var list = document.getElementById('conv-list');
  if (list) {
    var cur = null, lastId = 0, thread = document.getElementById('thread'), rform = document.getElementById('reply-form'), body = document.getElementById('reply-body'), live = document.getElementById('support-live'), prevUnread = -1;
    function load() {
      api('/admin/api/support/conversations').then(function (r) {
        if (!r.conversations) return; list.textContent = ''; var unread = 0;
        r.conversations.forEach(function (c) {
          unread += c.agent_unread; var li = el('li'); var b = el('button', { type: 'button' });
          if (cur === c.id) b.setAttribute('aria-current', 'true');
          b.appendChild(el('strong', null, c.customer_name + ' '));
          if (c.agent_unread) b.appendChild(el('span', { class: 'unread' }, c.agent_unread + ' unread'));
          b.appendChild(el('br')); b.appendChild(el('span', { class: 'small' }, c.status + (c.agent_name ? ' · ' + c.agent_name : ' · unassigned') + (c.reported ? ' · REPORTED' : '') + (c.blocked ? ' · blocked' : '')));
          b.appendChild(el('br')); b.appendChild(el('span', { class: 'small' }, (c.last_body || '').slice(0, 60)));
          b.addEventListener('click', function () { cur = c.id; lastId = 0; thread.textContent = ''; rform.hidden = false; pull(); load(); });
          li.appendChild(b); list.appendChild(li);
        });
        if (unread > prevUnread && prevUnread >= 0) live.textContent = 'New customer message.'; prevUnread = unread;
      });
    }
    function pull() {
      if (!cur) return;
      api('/admin/api/support/conv/' + cur + '?since=' + lastId).then(function (r) { (r.messages || []).forEach(function (m) { lastId = Math.max(lastId, m.id); addMsg(thread, m.sender === 'agent' ? 'msg-me' : m.sender === 'customer' ? 'msg-them' : 'msg-sys', m.sender === 'agent' ? 'Agent' : m.sender === 'customer' ? 'Customer' : '', m.body); }); });
    }
    rform.addEventListener('submit', function (e) { e.preventDefault(); var v = body.value.trim(); if (!v || !cur) return; api('/admin/api/support/conv/' + cur + '/reply', 'POST', { body: v }).then(function (r) { if (r.error) live.textContent = r.error; else { body.value = ''; pull(); load(); } }); });
    ['assign', 'close', 'block'].forEach(function (a) { document.getElementById(a + '-btn').addEventListener('click', function () { if (!cur) return; if (a !== 'assign' && !window.confirm('Are you sure you want to ' + a + ' this conversation?')) return; api('/admin/api/support/conv/' + cur + '/' + a, 'POST', {}).then(load); }); });
    var pb = document.getElementById('presence');
    pb.addEventListener('click', function () { var on = pb.dataset.online !== 'true'; api('/admin/api/support/presence', 'POST', { online: on }).then(function (r) { pb.dataset.online = String(r.online); pb.setAttribute('aria-pressed', String(r.online)); pb.textContent = r.online ? 'You are online - go offline' : 'You are offline - go online'; }); });
    load(); setInterval(function () { load(); pull(); }, 4000);
  }
})();
