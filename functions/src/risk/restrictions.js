// @ts-check
// Pure helpers for temporary admin restrictions. Multiple cases may overlap; one
// shorter or resolved case must never silently unlock another active restriction.

const MAX_ACTIVE_RESTRICTIONS = 20;

function validCaseId(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 512) : null;
}

function validUntilMs(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function normalizedRestrictions(profile = {}, nowMs = 0, includeExpired = false) {
  const byCase = new Map();
  if (Array.isArray(profile.riskRestrictions)) {
    profile.riskRestrictions.forEach((entry) => {
      const caseId = validCaseId(entry?.caseId);
      const untilMs = validUntilMs(entry?.untilMs);
      if (!caseId || !untilMs) return;
      if (!includeExpired && nowMs > 0 && untilMs <= nowMs) return;
      byCase.set(caseId, Math.max(untilMs, Number(byCase.get(caseId) || 0)));
    });
  }

  const legacyCaseId = validCaseId(profile.riskRestrictionCaseId);
  const legacyUntilMs = validUntilMs(profile.riskRestrictionUntilMs);
  if (
    legacyCaseId
    && legacyUntilMs
    && (includeExpired || nowMs <= 0 || legacyUntilMs > nowMs)
  ) {
    byCase.set(legacyCaseId, Math.max(legacyUntilMs, Number(byCase.get(legacyCaseId) || 0)));
  }

  return [...byCase.entries()]
    .map(([caseId, untilMs]) => ({ caseId, untilMs }))
    .sort((a, b) => a.untilMs - b.untilMs || a.caseId.localeCompare(b.caseId))
    .slice(-MAX_ACTIVE_RESTRICTIONS);
}

function addTemporaryRestriction(profile, caseId, untilMs, nowMs) {
  const normalizedCaseId = validCaseId(caseId);
  const normalizedUntilMs = validUntilMs(untilMs);
  if (!normalizedCaseId || !normalizedUntilMs) {
    throw new Error('addTemporaryRestriction: invalid case or expiration');
  }
  const current = normalizedRestrictions(profile, nowMs, false)
    .filter((entry) => entry.caseId !== normalizedCaseId);
  return [...current, { caseId: normalizedCaseId, untilMs: normalizedUntilMs }]
    .sort((a, b) => a.untilMs - b.untilMs || a.caseId.localeCompare(b.caseId))
    .slice(-MAX_ACTIVE_RESTRICTIONS);
}

function removeTemporaryRestriction(profile, caseId, nowMs) {
  const normalizedCaseId = validCaseId(caseId);
  return normalizedRestrictions(profile, nowMs, false)
    .filter((entry) => entry.caseId !== normalizedCaseId);
}

function restrictionSummary(entries = []) {
  const valid = entries.filter((entry) => validCaseId(entry?.caseId) && validUntilMs(entry?.untilMs));
  if (valid.length === 0) return { caseId: null, untilMs: null };
  const latest = valid.reduce((max, entry) => entry.untilMs > max.untilMs ? entry : max, valid[0]);
  return { caseId: latest.caseId, untilMs: latest.untilMs };
}

function activeRiskRestrictionState(profile = {}, nowMs = Date.now()) {
  const entries = normalizedRestrictions(profile, nowMs, false);
  if (entries.length > 0) {
    const summary = restrictionSummary(entries);
    return { active: true, entries, ...summary, indefinite: false };
  }

  // Compatibility for old documents that stored only a boolean and no expiration.
  const legacyUntilMs = validUntilMs(profile.riskRestrictionUntilMs);
  const indefinite = profile.riskBlockedFromNewAcceptances === true
    || profile.riskBlockedFromNewRides === true;
  if (indefinite && legacyUntilMs === 0 && !validCaseId(profile.riskRestrictionCaseId)) {
    return { active: true, entries: [], caseId: null, untilMs: null, indefinite: true };
  }
  return { active: false, entries: [], caseId: null, untilMs: null, indefinite: false };
}

module.exports = {
  MAX_ACTIVE_RESTRICTIONS,
  normalizedRestrictions,
  addTemporaryRestriction,
  removeTemporaryRestriction,
  restrictionSummary,
  activeRiskRestrictionState,
};
