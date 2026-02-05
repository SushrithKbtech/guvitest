const suspiciousKeywords = [
  'urgent', 'blocked', 'verify', 'otp', 'pin', 'password', 'kyc',
  'click', 'link', 'immediately', 'within', 'account', 'freeze', 'suspended',
  'fraud', 'security', 'alert'
];

function initIntelligence() {
  return {
    bankAccounts: new Set(),
    upiIds: new Set(),
    phishingLinks: new Set(),
    phoneNumbers: new Set(),
    employeeIds: new Set(),
    orgNames: new Set(),
    suspiciousKeywords: new Set()
  };
}

function addAll(set, values) {
  values.forEach((v) => {
    if (v) set.add(v);
  });
}

function extractIntelligenceFromText(text, scenario, intelligence) {
  if (!text) return;
  const lower = text.toLowerCase();

  const urlMatches = text.match(/https?:\/\/[^\s)]+/gi) || [];
  addAll(intelligence.phishingLinks, urlMatches);

  const upiMatches = text.match(/\b[\w.-]{2,}@[a-zA-Z]{2,}\b/g) || [];
  addAll(intelligence.upiIds, upiMatches);

  const phoneMatches = text.match(/\+?91[-\s]?\d{10}\b/g) || [];
  addAll(intelligence.phoneNumbers, phoneMatches);

  const employeeMatches = text.match(/\bEMP\d{4,}\b/gi) || [];
  addAll(intelligence.employeeIds, employeeMatches.map((v) => v.toUpperCase()));

  const accountMatches = text.match(/\b\d{9,18}\b/g) || [];
  addAll(intelligence.bankAccounts, accountMatches.filter((v) => v.length >= 9));

  if (scenario?.orgNames) {
    scenario.orgNames.forEach((org) => {
      if (lower.includes(org.toLowerCase())) intelligence.orgNames.add(org);
    });
  }

  suspiciousKeywords.forEach((keyword) => {
    if (lower.includes(keyword)) intelligence.suspiciousKeywords.add(keyword);
  });
}

function analyzeHoneypotMessage(text, metrics) {
  if (!text) return;
  const lower = text.toLowerCase();

  if (/(employee id|id number|department|badge|branch|callback|phone number|official number|proof)/i.test(text)) {
    metrics.askedCredentials = true;
  }

  if (/(verify|verification|official|call back|not comfortable|not sure|confirm|bank number)/i.test(text)) {
    metrics.skeptical = true;
  }

  if (/(busy|later|call me later|in a meeting|not now|wait|some time)/i.test(text)) {
    metrics.naturalDelay = true;
  }

  if (/(network|server|technical issue|otp not received|sms issue)/i.test(text)) {
    metrics.techIssueCount += 1;
  }

  if (/(otp is|my otp|pin is|account number is|here is my otp|share otp)/i.test(text)) {
    metrics.tooCompliant = true;
  }

  if (/(scam|fraudster|fake|cheat|police|cybercrime)/i.test(text)) {
    metrics.tooObvious = true;
  }

  metrics.honeypotMessages += 1;
}

function computeScore({ turns, intelligence, metrics }) {
  let score = 0;

  if (metrics.askedCredentials) score += 20;
  if (metrics.skeptical) score += 20;

  if (metrics.naturalDelay && metrics.techIssueCount <= Math.ceil(metrics.honeypotMessages / 2)) {
    score += 20;
  }

  const intelCount = [
    intelligence.bankAccounts.size,
    intelligence.upiIds.size,
    intelligence.phishingLinks.size,
    intelligence.phoneNumbers.size,
    intelligence.employeeIds.size,
    intelligence.orgNames.size
  ].filter((c) => c > 0).length;

  if (intelCount >= 3) score += 20;
  if (turns >= 10) score += 20;

  if (metrics.tooCompliant) score -= 10;
  if (metrics.tooObvious) score -= 10;

  score = Math.max(0, Math.min(100, score));

  return { score, intelCount };
}

function classifyQuality(score, metrics) {
  if (metrics.tooCompliant) return 'BAD - Too compliant';
  if (score >= 80) return 'EXCELLENT - Natural conversation, good intelligence extraction';
  if (score >= 60) return 'GOOD - Some skepticism and extraction';
  if (score >= 40) return 'FAIR - Needs improvement';
  return 'POOR - Weak honeypot behavior';
}

module.exports = {
  initIntelligence,
  extractIntelligenceFromText,
  analyzeHoneypotMessage,
  computeScore,
  classifyQuality
};
