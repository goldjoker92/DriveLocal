// Pure local autocomplete ranking. It is accent-insensitive, tolerant to a small
// typo and deterministic. Personal usage counts only add a bounded boost; they
// never hide the city's generally useful places.

export const MAX_PLACE_SUGGESTIONS = 5;
export const STRONG_LOCAL_MATCH_SCORE = 420;

export function normalizePlaceSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function boundedLevenshtein(left, right, maxDistance = 2) {
  if (left === right) return 0;
  if (!left || !right) return Math.max(left.length, right.length);
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMinimum = current[0];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[right.length];
}

function candidateSearchText(entry) {
  return normalizePlaceSearchText([
    entry.label,
    entry.secondaryLabel,
    entry.queryText,
    ...(Array.isArray(entry.aliases) ? entry.aliases : []),
  ].join(' '));
}

function tokenScore(queryToken, candidateTokens) {
  let best = 0;
  for (const candidateToken of candidateTokens) {
    if (candidateToken === queryToken) best = Math.max(best, 110);
    else if (candidateToken.startsWith(queryToken)) best = Math.max(best, 82);
    else if (candidateToken.includes(queryToken)) best = Math.max(best, 52);
    else if (queryToken.length >= 4) {
      const maxDistance = queryToken.length >= 7 ? 2 : 1;
      const distance = boundedLevenshtein(queryToken, candidateToken, maxDistance);
      if (distance <= maxDistance) best = Math.max(best, 40 - distance * 8);
    }
  }
  return best;
}

export function scoreCityPlace(entry, query, usageCount = 0) {
  const normalizedQuery = normalizePlaceSearchText(query);
  if (normalizedQuery.length < 2) return 0;

  const searchable = candidateSearchText(entry);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const candidateTokens = searchable.split(' ').filter(Boolean);
  let score = Number(entry.priority || 0) * 0.6;

  if (searchable === normalizedQuery) score += 1000;
  else if (searchable.startsWith(normalizedQuery)) score += 620;
  else if (searchable.includes(normalizedQuery)) score += 360;

  let matchedTokens = 0;
  for (const queryToken of queryTokens) {
    const best = tokenScore(queryToken, candidateTokens);
    if (best > 0) matchedTokens += 1;
    score += best;
  }

  if (matchedTokens !== queryTokens.length) return 0;
  score += Math.min(90, Math.log2(Math.max(0, Number(usageCount)) + 1) * 22);
  return Math.round(score);
}

export function searchCityPlacePack(pack, query, usageById = {}, limit = MAX_PLACE_SUGGESTIONS) {
  if (!pack || !Array.isArray(pack.entries)) return [];
  return pack.entries
    .map((entry) => ({
      entry,
      score: scoreCityPlace(entry, query, usageById?.[entry.id] || 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.entry.label.localeCompare(right.entry.label, 'pt-BR'))
    .slice(0, Math.max(1, Math.min(MAX_PLACE_SUGGESTIONS, Number(limit) || MAX_PLACE_SUGGESTIONS)))
    .map(({ entry, score }) => Object.freeze({
      id: `city_pack:${entry.id}`,
      localId: entry.id,
      source: 'city_pack',
      label: entry.label,
      secondaryLabel: entry.secondaryLabel,
      queryText: entry.queryText,
      category: entry.category,
      score,
      hasCoordinates: false,
    }));
}

export function hasStrongLocalPlaceMatch(results) {
  return Array.isArray(results) && results.some((item) => Number(item?.score || 0) >= STRONG_LOCAL_MATCH_SCORE);
}
