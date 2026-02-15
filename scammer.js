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

function detectRequests(victimMessage) {
  const text = (victimMessage || '').toLowerCase();
  return {
    wantsEmployeeId: /(employee id|emp id|id number|badge)/i.test(text),
    wantsDepartment: /(department|dept)/i.test(text),
    wantsPhone: /(callback|call back|phone|number|official number|contact)/i.test(text),
    wantsBranch: /(branch)/i.test(text),
    wantsLink: /(link|website|url|verify online|verification link)/i.test(text),
    wantsUpi: /(upi|vpa)/i.test(text),
    wantsAccount: /(account number|acct|a\/c|bank account)/i.test(text)
  };
}

function buildPrompt({ scenario, turn, victimMessage, conversationHistory, needsAnswer }) {
  const historyText = conversationHistory
    .slice(-10)
    .map((m) => `${m.sender.toUpperCase()}: ${m.text}`)
    .join('\n');

  const phase = phaseForTurn(turn);
  const requests = detectRequests(victimMessage);
  const historyTextLower = historyText.toLowerCase();
  const alreadyShared = {
    employeeId: scenario.employeeId && historyTextLower.includes(String(scenario.employeeId).toLowerCase()),
    phone: scenario.phoneNumber && historyTextLower.includes(String(scenario.phoneNumber).toLowerCase()),
    upiId: scenario.upiId && historyTextLower.includes(String(scenario.upiId).toLowerCase()),
    phishingLink: scenario.phishingLink && historyTextLower.includes(String(scenario.phishingLink).toLowerCase())
  };
  const phaseInstruction = {
    phase1: 'Open with the scenario’s core issue. Use the scenario script tone and details.',
    phase2: 'Provide fake credentials (employee ID, department, phone) if applicable to the scenario.',
    phase3: 'Pressure for the scenario’s target action (OTP, payment, app install, link click). Share link/UPI if applicable.',
    phase4: 'Increase urgency and consequences consistent with the scenario.'
  }[phase];

  const scenarioDetails = `ORG: ${scenario.orgNames.join(', ')}\nDEPARTMENT: ${scenario.department}\nEMPLOYEE ID: ${scenario.employeeId}\nPHONE: ${scenario.phoneNumber}\nPHISHING LINK: ${scenario.phishingLink}\nUPI ID: ${scenario.upiId}\nBANK ACCOUNT: ${scenario.bankAccount || 'N/A'}`;

  const followUp = needsAnswer ? 'The victim asked a question. Answer it directly before pushing your goal.' : '';
  const requestSummary = `REQUESTS: employeeId=${requests.wantsEmployeeId}, department=${requests.wantsDepartment}, phone=${requests.wantsPhone}, branch=${requests.wantsBranch}, link=${requests.wantsLink}, upi=${requests.wantsUpi}, account=${requests.wantsAccount}`;
  const shareHint = `ALREADY_SHARED: employeeId=${alreadyShared.employeeId}, phone=${alreadyShared.phone}, upi=${alreadyShared.upiId}, link=${alreadyShared.phishingLink}. If a detail has not been shared yet, include one in this reply.`;

  const phaseExamples = (scenario.script?.[phase] || []).slice(0, 2).map((s) => `- ${s}`).join('\n');
  const system = [
    'You are simulating a scammer for security testing purposes.',
    `SCENARIO: ${scenario.label}. You are impersonating ${scenario.orgNames[0] || 'a trusted organization'}.`,
    'YOUR GOAL: Achieve the scenario’s objective (e.g., OTP, payment, app install, link click, verification).',
    'TACTICS:',
    '- Create urgency consistent with the scenario (deadline, disconnection, penalty, cancellation, etc.)',
    '- Impersonate authority using the scenario department and org',
    '- Provide fake credentials when asked or by mid-conversation (Employee ID, Department, Phone).',
    '- Share phishing links or UPI ID at least once by turns 6-10 IF the scenario includes them.',
    '- If asked for identity details, use the exact provided values (Employee ID, Phone, UPI ID, Bank Account).',
    '- Get aggressive if victim delays too much',
    'STRICT SCENARIO RULES:',
    `- Do NOT mention "unusual activity" or "account blocked" unless it matches the scenario type.`,
    `- Use scenario-specific language (e.g., parcel hold, challan, bill disconnection, prize claim).`,
    `PHASE EXAMPLES:\n${phaseExamples || '- (no examples)'}`,
    requestSummary,
    shareHint,
    'CONVERSATION HISTORY:',
    historyText || '(empty)',
    'VICTIM\'S LAST MESSAGE:',
    `"${victimMessage || ''}"`,
    `PHASE GUIDANCE: ${phaseInstruction}`,
    followUp,
    'OUTPUT RULES:',
    '- Output ONLY the scammer message text.',
    '- Do not include analysis, explanations, labels, or quotes.',
    '- Keep it short (1-2 sentences).'
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

function fallbackByRequest({ scenario, turn, victimMessage }) {
  const requests = detectRequests(victimMessage);
  const phase = phaseForTurn(turn);

  const parts = [];
  if (requests.wantsDepartment) parts.push(`Department: ${scenario.department}`);
  if (requests.wantsEmployeeId) parts.push(`Employee ID: ${scenario.employeeId}`);
  if (requests.wantsPhone) parts.push(`Official number: ${scenario.phoneNumber}`);
  if (requests.wantsBranch) parts.push('We are calling from the main branch in Mumbai.');
  if (requests.wantsLink) parts.push(`Please verify here: ${scenario.phishingLink}`);
  if (requests.wantsUpi) parts.push(`Use UPI ID: ${scenario.upiId} for verification.`);
  if (requests.wantsAccount) {
    parts.push(`Account reference: ${scenario.bankAccount || '1234567890123456'}.`);
  }

  if (parts.length > 0) {
    return `${parts.join(' ')} Please act quickly to avoid blocking.`;
  }

  if (phase === 'phase2') {
    return `I am from ${scenario.orgNames[0]} ${scenario.department}. Employee ID: ${scenario.employeeId}. Official number: ${scenario.phoneNumber}. Verify now to avoid blocking.`;
  }

  if (phase === 'phase3') {
    return `Share OTP immediately to secure your account. You can verify using ${scenario.upiId} or ${scenario.phishingLink}.`;
  }

  return pickFallbackMessage({ scenario, turn });
}

function cleanScammerMessage(text) {
  if (!text) return text;
  let cleaned = text.trim();

  // Strip code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[\s\S]*?\n/, '').replace(/```$/g, '').trim();
  }

  // Try JSON extraction
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.message === 'string') {
      cleaned = parsed.message.trim();
    }
  } catch (_) {
    // ignore JSON parse errors
  }

  // Prefer explicit SCAMMER: lines
  const scammerLine = cleaned.split('\n').find((line) => /^\s*scammer\s*:/i.test(line));
  if (scammerLine) {
    cleaned = scammerLine.replace(/^\s*scammer\s*:\s*/i, '').trim();
  }

  const metaPhrases = /(the user wants|the instructions|output only|the scammer|the conversation|pre-configured|generate the|analysis:|assistant:|system:)/i;
  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !metaPhrases.test(line));

  if (lines.length > 0) {
    cleaned = lines.join(' ');
  }

  cleaned = cleaned.replace(/^\"|\"$/g, '').replace(/^\s*SCAMMER:\s*/i, '').trim();

  const sentences = cleaned.match(/[^.!?]+[.!?]*/g) || [cleaned];
  if (sentences.length > 2) {
    cleaned = sentences.slice(0, 2).join(' ').trim();
  }

  if (!cleaned) return text.trim();
  return cleaned;
}

async function generateScammerMessage({ provider, apiKey, model, scenario, turn, victimMessage, conversationHistory }) {
  const needsAnswer = shouldAnswerQuestion(victimMessage);
  const { system, scenarioDetails } = buildPrompt({ scenario, turn, victimMessage, conversationHistory, needsAnswer });

  if (provider === 'openai' && apiKey) {
    const raw = await generateWithOpenAI({ apiKey, model, systemPrompt: system, scenarioDetails });
    return cleanScammerMessage(raw);
  }

  return fallbackByRequest({ scenario, turn, victimMessage });
}

module.exports = {
  loadScenario,
  generateScammerMessage
};
