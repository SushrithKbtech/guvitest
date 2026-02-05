const fs = require('fs');
const path = require('path');
const axios = require('axios');

const SCENARIO_DIR = path.join(__dirname, 'scenarios');

function loadScenario(id) {
  const fallback = path.join(SCENARIO_DIR, 'bank-fraud.json');
  let filePath = fallback;
  if (id) {
    const candidate = path.join(SCENARIO_DIR, `${id}.json`);
    if (fs.existsSync(candidate)) {
      filePath = candidate;
    }
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function phaseForTurn(turn) {
  if (turn <= 2) return 'phase1';
  if (turn <= 5) return 'phase2';
  if (turn <= 10) return 'phase3';
  return 'phase4';
}

function buildPrompt({ scenario, turn, victimMessage, conversationHistory, needsAnswer }) {
  const historyText = conversationHistory
    .slice(-10)
    .map((m) => `${m.sender.toUpperCase()}: ${m.text}`)
    .join('\n');

  const phase = phaseForTurn(turn);
  const phaseInstruction = {
    phase1: 'Initial urgent message about account issue. Create urgency.',
    phase2: 'Provide fake credentials (employee ID, department, phone).',
    phase3: 'Pressure for OTP/PIN/account details or phishing link.',
    phase4: 'Get aggressive or repeat urgency if victim delays.'
  }[phase];

  const scenarioDetails = `ORG: ${scenario.orgNames.join(', ')}\nDEPARTMENT: ${scenario.department}\nEMPLOYEE ID: ${scenario.employeeId}\nPHONE: ${scenario.phoneNumber}\nPHISHING LINK: ${scenario.phishingLink}\nUPI ID: ${scenario.upiId}`;

  const followUp = needsAnswer ? 'The victim asked a question. Answer it directly before pushing your goal.' : '';

  const system = [
    'You are simulating a bank fraud scammer for security testing purposes.',
    `SCENARIO: You are impersonating a ${scenario.orgNames[0]} employee trying to scam someone.`,
    'YOUR GOAL: Get the victim to share their OTP, account number, or click a phishing link.',
    'TACTICS:',
    '- Create urgency ("account will be blocked in 2 hours")',
    '- Impersonate authority (claim to be from fraud department)',
    '- Provide fake credentials when asked (Employee ID, Department, Phone)',
    '- Share phishing links when victim asks for verification',
    '- Get aggressive if victim delays too much',
    'CONVERSATION HISTORY:',
    historyText || '(empty)',
    'VICTIM\'S LAST MESSAGE:',
    `"${victimMessage || ''}"`,
    `PHASE GUIDANCE: ${phaseInstruction}`,
    followUp,
    'Generate your next scammer message (1-2 sentences, natural Indian English, stay in character).'
  ].filter(Boolean).join('\n');

  return { system, scenarioDetails };
}

async function generateWithOpenAI({ apiKey, model, systemPrompt, scenarioDetails }) {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: scenarioDetails }
      ],
      temperature: 0.7,
      max_tokens: 120
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    }
  );

  const content = response?.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned empty message');
  return content.trim().replace(/^"|"$/g, '');
}

function pickFallbackMessage({ scenario, turn }) {
  const phase = phaseForTurn(turn);
  const options = scenario.script?.[phase] || [];
  if (options.length === 0) {
    return 'Your account is at risk. Share OTP now to avoid blocking.';
  }
  const pick = options[Math.floor(Math.random() * options.length)];
  return pick;
}

function shouldAnswerQuestion(victimMessage) {
  if (!victimMessage) return false;
  if (victimMessage.includes('?')) return true;
  const lower = victimMessage.toLowerCase();
  return ['who are you', 'which branch', 'callback', 'number', 'id', 'employee', 'department', 'verify', 'proof'].some((k) => lower.includes(k));
}

async function generateScammerMessage({ provider, apiKey, model, scenario, turn, victimMessage, conversationHistory }) {
  const needsAnswer = shouldAnswerQuestion(victimMessage);
  const { system, scenarioDetails } = buildPrompt({ scenario, turn, victimMessage, conversationHistory, needsAnswer });

  if (provider === 'openai' && apiKey) {
    return generateWithOpenAI({ apiKey, model, systemPrompt: system, scenarioDetails });
  }

  return pickFallbackMessage({ scenario, turn });
}

module.exports = {
  loadScenario,
  generateScammerMessage
};
