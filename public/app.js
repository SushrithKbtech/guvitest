const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const form = document.getElementById('runForm');
const scenarioSelect = document.getElementById('scenarioSelect');

function setStatus(text, type = 'idle') {
  statusEl.textContent = text;
  statusEl.dataset.state = type;
  if (type === 'running') {
    statusEl.style.borderColor = 'rgba(78,225,160,0.6)';
    statusEl.style.color = '#4ee1a0';
  } else if (type === 'error') {
    statusEl.style.borderColor = 'rgba(255,107,107,0.6)';
    statusEl.style.color = '#ff6b6b';
  } else {
    statusEl.style.borderColor = 'rgba(82,166,255,0.35)';
    statusEl.style.color = '#52a6ff';
  }
}

function appendLine(text) {
  logEl.textContent += `${text}\n`;
  logEl.scrollTop = logEl.scrollHeight;
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
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  logEl.textContent = '';
  setStatus('Running', 'running');

  const data = Object.fromEntries(new FormData(form).entries());
  data.turns = Number(data.turns || 12);

  const res = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  const { runId } = await res.json();
  const stream = new EventSource(`/api/stream/${runId}`);

  stream.addEventListener('line', (event) => {
    const payload = JSON.parse(event.data);
    appendLine(payload.text);
  });

  stream.addEventListener('result', (event) => {
    const payload = JSON.parse(event.data);
    if (payload?.data?.score >= 80) {
      setStatus('Excellent', 'idle');
    } else {
      setStatus('Completed', 'idle');
    }
    stream.close();
  });

  stream.addEventListener('error', (event) => {
    appendLine('Stream error or closed.');
    setStatus('Error', 'error');
    stream.close();
  });
});

Promise.all([loadScenarios(), loadConfig()]).catch(() => {
  appendLine('Failed to load scenarios or config.');
});
