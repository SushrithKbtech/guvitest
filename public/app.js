const statusEl = document.getElementById('status');
const form = document.getElementById('runForm');
const scenarioSelect = document.getElementById('scenarioSelect');

const chatEl = document.getElementById('chat');
const runInfoEl = document.getElementById('runInfo');
const resultsSummaryEl = document.getElementById('resultsSummary');
const resultJsonEl = document.getElementById('resultJson');
const callbackSummaryEl = document.getElementById('callbackSummary');
const callbackJsonEl = document.getElementById('callbackJson');
const callbackHintEl = document.getElementById('callbackHint');
const agentNotesEl = document.getElementById('agentNotes');

const runBtn = document.getElementById('runBtn');
const clearBtn = document.getElementById('clearBtn');
const copyBtn = document.getElementById('copyBtn');

let transcript = [];
let lastHoneypotLatencyEl = null;
let stream = null;

function setStatus(text, type = 'idle') {
  statusEl.textContent = text;
  if (type === 'running') {
    statusEl.style.borderColor = 'rgba(16,185,129,0.55)';
    statusEl.style.background = 'rgba(16,185,129,0.14)';
  } else if (type === 'error') {
    statusEl.style.borderColor = 'rgba(239,68,68,0.55)';
    statusEl.style.background = 'rgba(239,68,68,0.14)';
  } else {
    statusEl.style.borderColor = 'rgba(82,166,255,0.30)';
    statusEl.style.background = 'rgba(82,166,255,0.14)';
  }
}

function sanitizeDisplayText(text) {
  const raw = String(text || '');
  return raw
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^#+\s+/gm, '')
    .trim();
}

function scrollToBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

function clearOutput() {
  transcript = [];
  lastHoneypotLatencyEl = null;
  chatEl.innerHTML = '';
  resultsSummaryEl.innerHTML = '';
  callbackSummaryEl.innerHTML = '';
  resultJsonEl.textContent = '';
  callbackJsonEl.textContent = '';
  callbackHintEl.textContent = 'Waiting for callback.';
  agentNotesEl.textContent = '';
  runInfoEl.textContent = 'Waiting for a run.';
}

function addTurnDivider(turnNumber) {
  const div = document.createElement('div');
  div.className = 'turnDivider';
  div.textContent = `Turn ${turnNumber}`;
  chatEl.appendChild(div);
  scrollToBottom();
}

function addNote(text) {
  const div = document.createElement('div');
  div.className = 'noteLine';
  div.textContent = sanitizeDisplayText(text);
  chatEl.appendChild(div);
  scrollToBottom();
}

function addMessage(role, text) {
  const msg = document.createElement('div');
  msg.className = `msg ${role}`;

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = role === 'scammer' ? 'SCAMMER' : 'HONEYPOT';

  let latencyEl = null;
  if (role === 'honeypot') {
    latencyEl = document.createElement('span');
    latencyEl.className = 'latency';
    latencyEl.textContent = '';
    meta.appendChild(latencyEl);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = sanitizeDisplayText(text);

  msg.appendChild(meta);
  msg.appendChild(bubble);
  chatEl.appendChild(msg);

  transcript.push({ role, text: sanitizeDisplayText(text) });
  scrollToBottom();

  return latencyEl;
}

function renderMetric({ label, value, chips }) {
  const card = document.createElement('div');
  card.className = 'metric';

  const l = document.createElement('div');
  l.className = 'metricLabel';
  l.textContent = label;

  const v = document.createElement('div');
  v.className = 'metricValue';
  v.textContent = String(value ?? '');

  card.appendChild(l);
  card.appendChild(v);

  const chipList = Array.isArray(chips) ? chips.filter(Boolean) : [];
  if (chipList.length > 0) {
    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'chips';
    chipList.slice(0, 40).forEach((item) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = String(item);
      chipsWrap.appendChild(chip);
    });
    card.appendChild(chipsWrap);
  }

  resultsSummaryEl.appendChild(card);
}

function renderMetricTo(target, { label, value, chips }) {
  const card = document.createElement('div');
  card.className = 'metric';

  const l = document.createElement('div');
  l.className = 'metricLabel';
  l.textContent = label;

  const v = document.createElement('div');
  v.className = 'metricValue';
  v.textContent = String(value ?? '');

  card.appendChild(l);
  card.appendChild(v);

  const chipList = Array.isArray(chips) ? chips.filter(Boolean) : [];
  if (chipList.length > 0) {
    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'chips';
    chipList.slice(0, 60).forEach((item) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = String(item);
      chipsWrap.appendChild(chip);
    });
    card.appendChild(chipsWrap);
  }

  target.appendChild(card);
}

function renderResults(summary) {
  resultsSummaryEl.innerHTML = '';
  callbackSummaryEl.innerHTML = '';
  if (!summary || typeof summary !== 'object') return;

  const score = summary.score ?? '';
  const quality = summary.quality ?? '';
  const behavior = summary.behaviorPattern ?? '';
  const scamDetected = summary.scamDetected ? 'YES' : 'NO';

  renderMetric({ label: 'Score', value: `${score}/100` });
  renderMetric({ label: 'Quality', value: quality });
  renderMetric({ label: 'Scam Detected', value: scamDetected });
  renderMetric({ label: 'Behavior', value: behavior });

  const intel = summary.intelligence || {};
  renderMetric({ label: 'Phone Numbers', value: '', chips: intel.phoneNumbers || [] });
  renderMetric({ label: 'UPI IDs', value: '', chips: intel.upiIds || [] });
  renderMetric({ label: 'Links', value: '', chips: intel.phishingLinks || [] });
  renderMetric({ label: 'Bank Accounts', value: '', chips: intel.bankAccounts || [] });
  renderMetric({ label: 'Employee IDs', value: '', chips: intel.employeeIds || [] });
  renderMetric({ label: 'Org Names', value: '', chips: intel.orgNames || [] });
  renderMetric({ label: 'Keywords', value: '', chips: intel.suspiciousKeywords || [] });

  resultJsonEl.textContent = JSON.stringify(summary, null, 2);

  const cb = summary.callback || null;
  if (cb) {
    callbackHintEl.textContent = 'Callback received.';
    agentNotesEl.textContent = sanitizeDisplayText(cb.agentNotes || '(no agentNotes in callback)');
    callbackJsonEl.textContent = JSON.stringify(cb, null, 2);

    renderMetricTo(callbackSummaryEl, { label: 'Session ID', value: cb.sessionId || '(none)' });
    renderMetricTo(callbackSummaryEl, { label: 'Scam Detected', value: cb.scamDetected ? 'YES' : 'NO' });
    renderMetricTo(callbackSummaryEl, { label: 'Total Messages', value: cb.totalMessagesExchanged ?? '(none)' });

    const extracted = cb.extractedIntelligence || {};
    Object.keys(extracted).forEach((key) => {
      const val = extracted[key];
      if (Array.isArray(val)) {
        renderMetricTo(callbackSummaryEl, {
          label: key,
          value: val.length ? '' : '(none)',
          chips: val
        });
      } else if (val && typeof val === 'object') {
        renderMetricTo(callbackSummaryEl, { label: key, value: JSON.stringify(val) });
      } else {
        renderMetricTo(callbackSummaryEl, { label: key, value: val ?? '(none)' });
      }
    });
  } else {
    callbackHintEl.textContent = 'No callback received.';
    agentNotesEl.textContent = '(no callback agentNotes)';
    callbackJsonEl.textContent = '';
  }
}

function handleLineEvent(evt) {
  const raw = String(evt?.text || '');
  const text = sanitizeDisplayText(raw);

  const turnMatch = text.match(/^---\s*Turn\s*(\d+)\s*---$/i);
  if (turnMatch) {
    addTurnDivider(turnMatch[1]);
    return;
  }

  if (text.startsWith('SCAMMER:')) {
    lastHoneypotLatencyEl = null;
    addMessage('scammer', text.replace(/^SCAMMER:\s*/i, ''));
    return;
  }

  if (text.startsWith('HONEYPOT:')) {
    lastHoneypotLatencyEl = addMessage('honeypot', text.replace(/^HONEYPOT:\s*/i, ''));
    return;
  }

  if (text.toLowerCase().startsWith('response time:')) {
    if (lastHoneypotLatencyEl) {
      lastHoneypotLatencyEl.textContent = text.replace(/^response time:\s*/i, '');
    }
    return;
  }

  if (evt?.level === 'error') {
    addNote(text);
  }
}

async function loadScenarios() {
  const res = await fetch('/api/scenarios');
  const scenarios = await res.json();
  scenarioSelect.innerHTML = scenarios
    .map((s) => `<option value="${s.id}">${s.label}</option>`)
    .join('');
}

async function loadConfig() {
  const res = await fetch('/api/config');
  const config = await res.json();
  if (config.provider) form.elements.provider.value = config.provider;
  if (config.model) form.elements.model.value = config.model;
  if (config.openaiApiKey) form.elements.openaiApiKey.value = config.openaiApiKey;
  if (config.publicBaseUrl) {
    form.elements.publicBaseUrl.value = config.publicBaseUrl;
  } else {
    form.elements.publicBaseUrl.value = window.location.origin;
  }
  if (config.honeypotUrl) form.elements.honeypotUrl.value = config.honeypotUrl;
  if (config.honeypotApiKey) form.elements.honeypotApiKey.value = config.honeypotApiKey;
}

function copyTranscript() {
  const lines = transcript.map((m) => `${m.role.toUpperCase()}: ${m.text}`);
  const text = lines.join('\n');
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  } else {
    window.prompt('Copy transcript:', text);
  }
}

function stopStream() {
  if (stream) {
    stream.close();
    stream = null;
  }
}

clearBtn.addEventListener('click', () => {
  stopStream();
  clearOutput();
  setStatus('Idle', 'idle');
});

copyBtn.addEventListener('click', copyTranscript);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  stopStream();
  clearOutput();

  setStatus('Running', 'running');
  runBtn.disabled = true;

  try {
    const data = Object.fromEntries(new FormData(form).entries());
    data.turns = Number(data.turns || 12);

    const scenarioName = scenarioSelect.options[scenarioSelect.selectedIndex]?.textContent || data.scenarioId;
    runInfoEl.textContent = `Scenario: ${scenarioName} | Turns: ${data.turns}`;

    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      setStatus('Error', 'error');
      runBtn.disabled = false;
      addNote(`Request failed: HTTP ${res.status}`);
      return;
    }

    const { runId } = await res.json();
    stream = new EventSource(`/api/stream/${runId}`);

    stream.addEventListener('line', (event2) => {
      const payload = JSON.parse(event2.data);
      handleLineEvent(payload);
    });

    stream.addEventListener('result', (event2) => {
      const payload = JSON.parse(event2.data);
      const summary = payload?.data || null;
      renderResults(summary);
      if (summary?.score >= 80) setStatus('Excellent', 'idle');
      else setStatus('Completed', 'idle');
      runBtn.disabled = false;
      stopStream();
    });

    stream.addEventListener('error', () => {
      addNote('Stream error or closed.');
      setStatus('Error', 'error');
      runBtn.disabled = false;
      stopStream();
    });
  } catch (err) {
    addNote(`Error: ${String(err && err.message ? err.message : err)}`);
    setStatus('Error', 'error');
    runBtn.disabled = false;
    stopStream();
  }
});

Promise.all([loadScenarios(), loadConfig()]).catch(() => {
  setStatus('Error', 'error');
});
