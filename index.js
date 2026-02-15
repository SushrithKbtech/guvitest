const path = require('path');
const fs = require('fs');
const express = require('express');
const axios = require('axios');
const chalk = require('chalk');
const minimist = require('minimist');
const { randomUUID } = require('crypto');
require('dotenv').config();

const { loadScenario, generateScammerMessage } = require('./scammer');
const {
  initIntelligence,
  extractIntelligenceFromText,
  analyzeHoneypotMessage,
  computeScore,
  classifyQuality
} = require('./evaluator');

const DEFAULT_TURNS = 12;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getConfig(overrides = {}) {
  return {
    honeypotUrl: overrides.honeypotUrl || process.env.HONEYPOT_URL || 'http://localhost:3000/api/conversation',
    honeypotApiKey: overrides.honeypotApiKey || process.env.HONEYPOT_API_KEY || '',
    turns: Number(overrides.turns || process.env.TURNS || DEFAULT_TURNS),
    scenarioId: overrides.scenarioId || process.env.SCENARIO || 'combined',
    channel: overrides.channel || process.env.CHANNEL || 'SMS',
    language: overrides.language || process.env.LANGUAGE || 'English',
    locale: overrides.locale || process.env.LOCALE || 'IN',
    provider: overrides.provider || process.env.LLM_PROVIDER || 'openai',
    model: overrides.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    openaiApiKey: overrides.openaiApiKey || process.env.OPENAI_API_KEY || '',
    timeoutMs: Number(overrides.timeoutMs || process.env.TIMEOUT_MS || 20000),
    callbackWaitMs: Number(overrides.callbackWaitMs || process.env.CALLBACK_WAIT_MS || 5000),
    callbackUrl: overrides.callbackUrl || null,
    callbackBaseUrl: overrides.callbackBaseUrl || process.env.PUBLIC_BASE_URL || null,
    callbackPath: overrides.callbackPath || process.env.CALLBACK_PATH || '/callback',
    logDir: overrides.logDir || process.env.LOG_DIR || 'logs'
  };
}

function listScenarioFiles() {
  const dir = path.join(__dirname, 'scenarios');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
}

function pickRandomScenarioId() {
  const files = listScenarioFiles();
  if (files.length === 0) return 'combined';
  const idx = Math.floor(Math.random() * files.length);
  return path.basename(files[idx], '.json');
}

async function sendToHoneypot({ url, apiKey, payload, timeoutMs }) {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return axios.post(url, payload, { headers, timeout: timeoutMs });
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function runTest(config, hooks = {}) {
  const scenarioId = (!config.scenarioId || config.scenarioId === 'random') ? pickRandomScenarioId() : config.scenarioId;
  const scenario = loadScenario(scenarioId);
  const sessionId = randomUUID();
  const callbackUrl = config.callbackBaseUrl
    ? `${config.callbackBaseUrl}${config.callbackPath}?sessionId=${sessionId}`
    : config.callbackUrl;
  const conversationHistory = [];
  const intelligence = initIntelligence();
  const metrics = {
    askedCredentials: false,
    skeptical: false,
    naturalDelay: false,
    techIssueCount: 0,
    tooCompliant: false,
    tooObvious: false,
    honeypotMessages: 0
  };
  const turnsData = [];
  const errors = [];

  const emit = hooks.onEvent || (() => {});
  const emitLine = (text, level = 'info') => emit({ kind: 'line', level, text, ts: Date.now() });

  emitLine('=== GUVI HONEYPOT TESTER ===', 'header');
  emitLine(`Testing: ${config.honeypotUrl}`);
  emitLine(`API Key: ${config.honeypotApiKey || '(none)'}`);
  emitLine(`Scenario: ${scenario.label}`);
  if (config.provider === 'openai' && !config.openaiApiKey) {
    emitLine('OpenAI API key missing. Using fallback script messages.', 'error');
  }

  let lastVictimMessage = '';

  for (let turn = 1; turn <= config.turns; turn += 1) {
    emitLine(`--- Turn ${turn} ---`, 'turn');

    let scammerMessage;
    try {
      scammerMessage = await generateScammerMessage({
        provider: config.provider,
        apiKey: config.openaiApiKey,
        model: config.model,
        scenario,
        turn,
        victimMessage: lastVictimMessage,
        conversationHistory
      });
    } catch (err) {
      const msg = `LLM error: ${err.message}`;
      emitLine(msg, 'error');
      errors.push(msg);
      scammerMessage = scenario.script?.phase1?.[0] || 'Your account is at risk. Verify now.';
    }

    emitLine(`SCAMMER: ${scammerMessage}`);

    extractIntelligenceFromText(scammerMessage, scenario, intelligence);

    const now = Math.floor(Date.now() / 1000);
    const requestPayload = {
      sessionId,
      message: {
        sender: 'scammer',
        text: scammerMessage,
        timestamp: now
      },
      conversationHistory: [...conversationHistory],
      metadata: {
        channel: config.channel,
        language: config.language,
        locale: config.locale
      }
    };

    if (callbackUrl) {
      requestPayload.metadata.callbackUrl = callbackUrl;
    }

    let response;
    const start = Date.now();
    try {
      response = await sendToHoneypot({
        url: config.honeypotUrl,
        apiKey: config.honeypotApiKey,
        payload: requestPayload,
        timeoutMs: config.timeoutMs
      });
    } catch (err) {
      const msg = `Request failed: ${err.message}`;
      emitLine(msg, 'error');
      errors.push(msg);
      break;
    }

    const elapsed = Date.now() - start;
    const data = response?.data;
    if (!data || data.status !== 'success' || typeof data.reply !== 'string') {
      const msg = 'Invalid response format. Expected { status: "success", reply: "..." }';
      emitLine(msg, 'error');
      errors.push(msg);
      break;
    }

    const honeypotReply = data.reply.trim();
    emitLine(`HONEYPOT: ${honeypotReply}`);
    emitLine(`Response time: ${formatDuration(elapsed)}`);

    analyzeHoneypotMessage(honeypotReply, metrics);

    const scammerEntry = {
      sender: 'scammer',
      text: scammerMessage,
      timestamp: now
    };
    const userEntry = {
      sender: 'user',
      text: honeypotReply,
      timestamp: now + 1
    };

    conversationHistory.push(scammerEntry, userEntry);
    lastVictimMessage = honeypotReply;

    turnsData.push({
      turn,
      scammer: scammerMessage,
      honeypot: honeypotReply,
      responseTimeMs: elapsed
    });
  }

  let callbackData = null;
  if (config.callbackStore && config.callbackWaitMs > 0) {
    const endAt = Date.now() + config.callbackWaitMs;
    while (Date.now() < endAt) {
      callbackData = config.callbackStore.get(sessionId) || null;
      if (callbackData) break;
      await sleep(500);
    }
  }

  const { score } = computeScore({
    turns: turnsData.length,
    intelligence,
    metrics
  });

  const quality = classifyQuality(score, metrics);
  let behaviorPattern = 'Neutral';
  if (metrics.tooCompliant) {
    behaviorPattern = 'Too compliant (bad honeypot)';
  } else if (metrics.askedCredentials && metrics.skeptical) {
    behaviorPattern = 'Asking intelligent questions (excellent honeypot)';
  } else if (metrics.naturalDelay && !metrics.tooObvious) {
    behaviorPattern = 'Too evasive (good honeypot)';
  }
  const scamDetected = Boolean(metrics.skeptical || metrics.askedCredentials || metrics.tooObvious);

  emitLine('=== FINAL RESULTS ===', 'header');
  emitLine(`Total Turns: ${turnsData.length}`);

  const toArray = (set) => Array.from(set);

  emitLine('Intelligence Extracted:');
  emitLine(`  - Employee IDs: ${toArray(intelligence.employeeIds).join(', ') || '(none)'}`);
  emitLine(`  - Phone Numbers: ${toArray(intelligence.phoneNumbers).join(', ') || '(none)'}`);
  emitLine(`  - Phishing Links: ${toArray(intelligence.phishingLinks).join(', ') || '(none)'}`);
  emitLine(`  - UPI IDs: ${toArray(intelligence.upiIds).join(', ') || '(none)'}`);
  emitLine(`  - Bank Accounts: ${toArray(intelligence.bankAccounts).join(', ') || '(none)'}`);
  emitLine(`  - Organization Names: ${toArray(intelligence.orgNames).join(', ') || '(none)'}`);
  emitLine(`  - Suspicious Keywords: ${toArray(intelligence.suspiciousKeywords).join(', ') || '(none)'}`);

  emitLine(`Honeypot Quality Score: ${score}/100`);
  emitLine(quality);
  emitLine(`Behavior Pattern: ${behaviorPattern}`);
  emitLine(`Scam Detected: ${scamDetected ? 'YES' : 'NO'}`);

  const localCallback = {
    sessionId,
    scamDetected,
    totalMessagesExchanged: turnsData.length * 2,
    extractedIntelligence: {
      bankAccounts: toArray(intelligence.bankAccounts),
      upiIds: toArray(intelligence.upiIds),
      phishingLinks: toArray(intelligence.phishingLinks),
      phoneNumbers: toArray(intelligence.phoneNumbers),
      employeeIds: toArray(intelligence.employeeIds),
      orgNames: toArray(intelligence.orgNames),
      suspiciousKeywords: toArray(intelligence.suspiciousKeywords)
    }
  };

  if (callbackUrl) {
    emitLine(`Final Callback Received: ${callbackData ? 'YES' : 'NO'}`);
    if (callbackData) {
      emitLine('Callback Data:');
      emitLine(JSON.stringify(callbackData, null, 2));
      emitLine('Callback Data (local inference):');
      emitLine(JSON.stringify(localCallback, null, 2));
    } else {
      emitLine('Callback Data (local inference):');
      emitLine(JSON.stringify(localCallback, null, 2));
    }
  }

  const summary = {
    sessionId,
    config: {
      honeypotUrl: config.honeypotUrl,
      scenario: scenario.id,
      turns: config.turns
    },
    turns: turnsData,
    intelligence: {
      bankAccounts: toArray(intelligence.bankAccounts),
      upiIds: toArray(intelligence.upiIds),
      phishingLinks: toArray(intelligence.phishingLinks),
      phoneNumbers: toArray(intelligence.phoneNumbers),
      employeeIds: toArray(intelligence.employeeIds),
      orgNames: toArray(intelligence.orgNames),
      suspiciousKeywords: toArray(intelligence.suspiciousKeywords)
    },
    score,
    quality,
    behaviorPattern,
    scamDetected,
    callback: callbackData || null,
    callbackLocal: localCallback,
    errors
  };

  ensureDir(path.join(__dirname, config.logDir));
  const logPath = path.join(__dirname, config.logDir, `${sessionId}.json`);
  fs.writeFileSync(logPath, JSON.stringify(summary, null, 2), 'utf8');

  emit({ kind: 'result', data: summary });

  return summary;
}

function printLine(line, level) {
  if (level === 'header') return console.log(chalk.cyan.bold(line));
  if (level === 'turn') return console.log(chalk.yellow(line));
  if (level === 'error') return console.log(chalk.red(line));
  return console.log(line);
}

async function runCli() {
  const args = minimist(process.argv.slice(2));
  const config = getConfig({
    honeypotUrl: args.url,
    honeypotApiKey: args.key,
    turns: args.turns,
    scenarioId: args.scenario,
    provider: args.provider,
    model: args.model,
    callbackBaseUrl: args.callbackBase || null,
    callbackUrl: args.callbackUrl || null
  });

  await runTest(config, {
    onEvent: (evt) => {
      if (evt.kind === 'line') printLine(evt.text, evt.level);
    }
  });
}

async function runServer() {
  const app = express();
  app.use(express.json());

  const args = minimist(process.argv.slice(2));
  const host = args.host || process.env.HOST || '0.0.0.0';
  const port = Number(args.port || process.env.PORT || 8080);
  const callbackPath = process.env.CALLBACK_PATH || '/callback';

  const runs = new Map();
  const callbacks = new Map();

  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/config', (req, res) => {
    const config = getConfig();
    res.json({
      provider: config.provider,
      model: config.model,
      publicBaseUrl: config.callbackBaseUrl || '',
      openaiApiKey: config.openaiApiKey || ''
    });
  });

  app.get('/api/scenarios', (req, res) => {
    const files = listScenarioFiles();
    const list = files.map((f) => {
      const scenario = JSON.parse(fs.readFileSync(path.join(__dirname, 'scenarios', f), 'utf8'));
      return { id: scenario.id, label: scenario.label };
    });
    res.json([{ id: 'random', label: 'Random (rotates each run)' }, ...list]);
  });

  app.post('/api/run', async (req, res) => {
    const runId = randomUUID();
    const config = getConfig({
      honeypotUrl: req.body?.honeypotUrl,
      honeypotApiKey: req.body?.honeypotApiKey,
      turns: req.body?.turns,
      scenarioId: req.body?.scenarioId,
      channel: req.body?.channel,
      language: req.body?.language,
      locale: req.body?.locale,
      provider: req.body?.provider,
      model: req.body?.model,
      openaiApiKey: req.body?.openaiApiKey
    });

    const baseUrl = req.body?.publicBaseUrl || process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;

    const runRecord = {
      id: runId,
      events: [],
      clients: new Set(),
      done: false
    };
    runs.set(runId, runRecord);

    res.json({ runId });

    try {
      await runTest({
        ...config,
        callbackBaseUrl: baseUrl,
        callbackPath,
        callbackStore: callbacks
      }, {
        onEvent: (evt) => {
          runRecord.events.push(evt);
          for (const client of runRecord.clients) {
            client.write(`event: ${evt.kind}\n`);
            client.write(`data: ${JSON.stringify(evt)}\n\n`);
          }
        }
      });
    } catch (err) {
      const evt = { kind: 'error', text: err.message, ts: Date.now() };
      runRecord.events.push(evt);
      for (const client of runRecord.clients) {
        client.write(`event: error\n`);
        client.write(`data: ${JSON.stringify(evt)}\n\n`);
      }
    } finally {
      runRecord.done = true;
    }
  });

  app.get('/api/stream/:id', (req, res) => {
    const run = runs.get(req.params.id);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!run) {
      res.write('event: error\n');
      res.write(`data: ${JSON.stringify({ text: 'Run not found' })}\n\n`);
      res.end();
      return;
    }

    run.events.forEach((evt) => {
      res.write(`event: ${evt.kind}\n`);
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    });

    run.clients.add(res);
    req.on('close', () => run.clients.delete(res));
  });

  app.post(callbackPath, (req, res) => {
    const sessionId = req.query.sessionId || req.body?.sessionId;
    if (sessionId) {
      callbacks.set(sessionId, req.body || {});
    }
    res.json({ status: 'ok' });
  });

  app.listen(port, host, () => {
    console.log(chalk.green(`GUVI Tester UI running on http://${host}:${port}`));
  });
}

if (process.argv.includes('--cli')) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  runServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
