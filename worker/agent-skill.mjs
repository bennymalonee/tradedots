// Outcome feedback for recorded model forecasts. No model training or order tools.
const skillPolicy = 'agent-skill-v2';
const skillPrompt = 'research-context-v2';
const skillPolicies = ['agent-skill-v1', skillPolicy];
const skillNames = ['ATLAS', 'ORION', 'TITAN', 'NOVA', 'VEGA', 'LUNA'];
const skillBlendNames = skillNames.slice(0, 4);
const skillLimit = 600;
const skillGrace = 600000;
const skillSupport = 20;
const skillMaxWeight = .4;
const skillModelValid = model => typeof model === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(model);
const skillPolicyValid = policy => skillPolicies.includes(policy);
const skillPromptSafe = prompt => typeof prompt === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(prompt) ? prompt : null;
const skillProbabilityValid = probability => Number.isFinite(probability) && probability >= 0 && probability <= 1;
const skillReturnValid = value => Number.isFinite(value) && value >= -25 && value <= 25;
const skillDownsideValid = value => Number.isFinite(value) && value >= -25 && value <= 0;
const skillTime = value => typeof value === 'number' ? value : Date.parse(value);
const skillKey = quote => String(quote.venue || '') + ':' + String(quote.id || '');
const skillTerminal = record => record.status !== 'pending';

function skillInit(state) {
  if (!state.agent_skills) state.agent_skills = {version:1, records:[], retired_before:0, last_run:null};
  return state.agent_skills;
}

function skillVisibleRecords(state, model, now, policy) {
  if (!skillModelValid(model) || !skillPolicyValid(policy)) return [];
  return (state.agent_skills?.records || []).filter(record =>
    record.model === model && record.policy_version === policy &&
    (policy !== skillPolicy || record.prompt_version === skillPrompt) && skillNames.includes(record.agent) &&
    Number.isFinite(record.issued_at) && Number.isFinite(record.finished_at) &&
    record.issued_at <= record.finished_at && record.finished_at <= now
  ).slice(-skillLimit);
}

function skillEffectiveStatus(record, now) {
  return record.outcome?.at > now ? 'pending' : record.status;
}

function skillScoredRecords(records, name, now) {
  return records.filter(record => record.agent === name && skillEffectiveStatus(record, now) === 'evaluated' &&
    skillProbabilityValid(record.probability_up) && ['up','down'].includes(record.outcome?.actual) &&
    Number.isFinite(record.outcome?.at) && record.outcome.at <= now && record.outcome.at > record.finished_at);
}

function skillReturnScoredRecords(records, name, now) {
  return records.filter(record => record.agent === name && ['evaluated','unchanged'].includes(skillEffectiveStatus(record, now)) &&
    skillReturnValid(record.expected_return_pct) && Number.isFinite(record.outcome?.observed_return_pct) &&
    Number.isFinite(record.outcome?.at) && record.outcome.at <= now && record.outcome.at > record.finished_at);
}

function skillStoreReturnError(record) {
  if (skillReturnValid(record.expected_return_pct) && Number.isFinite(record.outcome?.observed_return_pct)) {
    record.outcome.expected_return_error_pct = record.expected_return_pct - record.outcome.observed_return_pct;
    record.outcome.absolute_return_error_pct = Math.abs(record.outcome.expected_return_error_pct);
  }
}

function skillBrier(record) {
  return (record.probability_up - (record.outcome.actual === 'up' ? 1 : 0)) ** 2;
}

function skillCappedWeights(raw) {
  const weights = {}, remaining = new Set(skillBlendNames);
  let budget = 1;
  while (remaining.size) {
    const sum = [...remaining].reduce((total, name) => total + raw[name], 0);
    const capped = [...remaining].filter(name => budget * raw[name] / sum > skillMaxWeight);
    if (!capped.length) {
      for (const name of remaining) weights[name] = budget * raw[name] / sum;
      break;
    }
    for (const name of capped) {weights[name] = skillMaxWeight; budget -= skillMaxWeight; remaining.delete(name);}
  }
  return Object.fromEntries(skillBlendNames.map(name => [name, weights[name]]));
}

export function registerAgentForecasts(state, report, now = Date.now()) {
  const issued = report?.at, finished = report?.finished_at, quoteAt = skillTime(report?.quote_at);
  const policy = report?.agent_policy_version, prompt = skillPromptSafe(report?.prompt_version);
  if (report?.mode !== 'ai' || report.status !== 'completed' || !skillPolicyValid(policy) ||
      (policy === skillPolicy && prompt !== skillPrompt) ||
      !skillModelValid(report.model) || typeof report.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(report.id) ||
      typeof report.symbol !== 'string' || !/^[A-Za-z0-9._/-]{1,40}$/.test(report.symbol) ||
      typeof report.market_id !== 'string' || !report.market_id || report.market_id.length > 160 ||
      !Number.isFinite(issued) || !Number.isFinite(finished) || issued > finished || finished > now ||
      !Number.isFinite(report.due_at) || report.due_at !== issued + 3600000 || report.due_at <= finished ||
      !Number.isFinite(quoteAt) || quoteAt > issued || !Number.isFinite(report.reference_price) || report.reference_price <= 0 ||
      !Array.isArray(report.agents)) return {registered:0, skipped_for_capacity:0, status:'ineligible'};
  const lab = skillInit(state), seen = new Set(lab.records.map(record => record.id));
  const candidates = [];
  for (const agent of report.agents) {
    if (!skillNames.includes(agent?.name)) continue;
    const id = 'skill:' + report.id + ':' + agent.name;
    if (seen.has(id)) continue;
    seen.add(id);
    if (finished <= (lab.retired_before || 0)) continue;
    const abstained = agent.stance === 'abstain' || agent.probability_up === null;
    const valid = ['bullish','bearish','neutral','abstain'].includes(agent.stance) &&
      (abstained || skillProbabilityValid(agent.probability_up)) &&
      (abstained || agent.forecast_symbol === report.symbol);
    candidates.push({id, report_id:report.id, agent:agent.name, model:report.model, policy_version:policy, prompt_version:prompt,
      symbol:report.symbol, market_id:report.market_id, issued_at:issued, finished_at:finished, due_at:report.due_at,
      quote_at:quoteAt, reference_price:report.reference_price,
      stance:['bullish','bearish','neutral','abstain'].includes(agent.stance) ? agent.stance : null,
      probability_up:skillProbabilityValid(agent.probability_up) ? agent.probability_up : null,
      expected_return_pct:policy === skillPolicy && skillReturnValid(agent.expected_return_pct) ? agent.expected_return_pct : null,
      downside_return_pct:policy === skillPolicy && skillDownsideValid(agent.downside_return_pct) ? agent.downside_return_pct : null,
      status:!valid ? 'invalid' : abstained ? 'abstained' : 'pending', outcome:null});
  }
  const needed = Math.max(0, lab.records.length + candidates.length - skillLimit);
  const removable = lab.records.filter(skillTerminal).sort((a,b) => a.finished_at - b.finished_at || a.id.localeCompare(b.id));
  if (needed > removable.length) {
    lab.last_registration = {at:now, registered:0, skipped_for_capacity:candidates.length};
    return {...lab.last_registration, status:'capacity_blocked'};
  }
  if (needed) {
    const retired = removable.slice(0, needed), ids = new Set(retired.map(record => record.id));
    lab.retired_before = Math.max(lab.retired_before || 0, ...retired.map(record => record.finished_at));
    lab.records = lab.records.filter(record => !ids.has(record.id));
  }
  lab.records.push(...candidates);
  lab.last_registration = {at:now, registered:candidates.length, skipped_for_capacity:0};
  return {...lab.last_registration, status:candidates.length ? 'registered' : 'already_registered_or_retired'};
}

export function updateAgentSkills(state, now = Date.now()) {
  const lab = state.agent_skills;
  if (!lab) return {evaluated:0, expired:0, unchanged:0};
  const quotes = new Map();
  for (const quote of (state.markets || []).slice(0, 100)) {
    // A collection timestamp never substitutes for an actual source quote time.
    const at = skillTime(quote.quote_at);
    const captureField = quote.collected_at !== undefined ? 'collected_at' : quote.fetched_at !== undefined ? 'fetched_at' : null;
    const observedAt = captureField ? skillTime(quote[captureField]) : now;
    if (!['stocks','crypto'].includes(quote.asset_class) || quote.cached || !Number.isFinite(quote.price) || quote.price <= 0 ||
        !Number.isFinite(at) || !Number.isFinite(observedAt) || at > observedAt || observedAt > now || now - at > 90000) continue;
    const key = skillKey(quote), existing = quotes.get(key);
    if (!existing || at > existing.at) quotes.set(key, {at, observedAt, price:quote.price,
      captureBasis:captureField || 'legacy_processing_time'});
  }
  const result = {evaluated:0, expired:0, unchanged:0};
  for (const record of lab.records.slice(0, skillLimit)) {
    if (record.status !== 'pending' || !skillPolicyValid(record.policy_version) ||
        (record.policy_version === skillPolicy && record.prompt_version !== skillPrompt) ||
        now < record.due_at || now <= record.finished_at) continue;
    if (now > record.due_at + skillGrace) {
      record.status = 'expired'; record.outcome = {at:now}; result.expired++; continue;
    }
    const quote = quotes.get(record.market_id);
    if (!quote || (record.policy_version === skillPolicy && quote.captureBasis === 'legacy_processing_time') ||
        quote.at < record.due_at || quote.at <= record.finished_at || quote.at <= record.quote_at ||
        !skillProbabilityValid(record.probability_up) || !Number.isFinite(record.reference_price) || record.reference_price <= 0) continue;
    const change = quote.price / record.reference_price - 1;
    if (!Number.isFinite(change)) continue;
    if (Math.abs(change) < .00001) {
      record.status = 'unchanged'; record.outcome = {at:now, quote_at:quote.at, observed_at:quote.observedAt,
        capture_basis:quote.captureBasis, observed_return_pct:change * 100};
      skillStoreReturnError(record); result.unchanged++; continue;
    }
    const actual = change > 0 ? 'up' : 'down';
    record.status = 'evaluated';
    record.outcome = {at:now, quote_at:quote.at, observed_at:quote.observedAt, capture_basis:quote.captureBasis,
      actual, observed_return_pct:change * 100,
      brier:(record.probability_up - (actual === 'up' ? 1 : 0)) ** 2};
    skillStoreReturnError(record);
    result.evaluated++;
  }
  lab.last_run = now;
  return result;
}

export function agentSkillSnapshot(state, model, now = Date.now(), policy = skillPolicy) {
  const records = skillVisibleRecords(state, model, now, policy), scored = Object.fromEntries(skillBlendNames.map(name =>
    [name, skillScoredRecords(records, name, now)]));
  const counts = Object.fromEntries(skillBlendNames.map(name => [name, scored[name].length]));
  const adaptive = skillBlendNames.every(name => counts[name] >= skillSupport);
  const raw = Object.fromEntries(skillBlendNames.map(name => {
    const loss = scored[name].reduce((sum, record) => sum + skillBrier(record), 0);
    const shrunk = (loss + skillSupport * .25) / (counts[name] + skillSupport);
    return [name, adaptive ? Math.exp(-2 * (shrunk - .25)) : 1];
  }));
  return {model:skillModelValid(model) ? model : null, policy_version:skillPolicyValid(policy) ? policy : null,
    prompt_version:policy === skillPolicy ? skillPrompt : null, at:now,
    weights:adaptive ? skillCappedWeights(raw) : Object.fromEntries(skillBlendNames.map(name => [name,.25])),
    scored_counts:counts, adaptive, min_scored:skillSupport, prior_strength:skillSupport, max_weight:skillMaxWeight,
    scheme:'shrunk_brier_softmax_v1'};
}

export function blendAgentForecasts(agents, snapshot) {
  const weights = snapshot?.weights;
  if (!skillPolicyValid(snapshot?.policy_version) || !weights ||
      !skillBlendNames.every(name => Number.isFinite(weights[name]) && weights[name] > 0 && weights[name] <= skillMaxWeight) ||
      Math.abs(skillBlendNames.reduce((sum, name) => sum + weights[name], 0) - 1) > 1e-10) {
    return {probability_up:null, weights:{}, contributors:[], reason:'invalid_forecast_snapshot'};
  }
  const seen = new Set(), values = [];
  const primary = snapshot?.primary_symbol || (Array.isArray(agents) ? agents.find(agent => skillBlendNames.includes(agent?.name) &&
    agent.stance !== 'abstain' && skillProbabilityValid(agent.probability_up) && typeof agent.forecast_symbol === 'string')?.forecast_symbol : null);
  for (const agent of Array.isArray(agents) ? agents : []) {
    if (!skillBlendNames.includes(agent?.name) || seen.has(agent.name) || !['bullish','bearish','neutral'].includes(agent.stance) ||
        !skillProbabilityValid(agent.probability_up) || !primary || agent.forecast_symbol !== primary) continue;
    seen.add(agent.name);
    const weight = weights[agent.name];
    if (!Number.isFinite(weight) || weight <= 0) continue;
    values.push({name:agent.name, probability_up:agent.probability_up, weight});
  }
  const total = values.reduce((sum, value) => sum + value.weight, 0);
  const contributors = values.map(value => ({...value, weight:value.weight / total}));
  return {probability_up:total ? contributors.reduce((sum, value) => sum + value.probability_up * value.weight, 0) : null,
    weights:Object.fromEntries(contributors.map(value => [value.name,value.weight])), contributors};
}

export function agentSkillSummary(state, model, now = Date.now(), policy = skillPolicy) {
  const records = skillVisibleRecords(state, model, now, policy);
  const roles = skillNames.map(name => {
    const all = records.filter(record => record.agent === name), scored = skillScoredRecords(records, name, now);
    const mean = scored.length ? scored.reduce((sum, record) => sum + skillBrier(record), 0) / scored.length : null;
    const returnScored = skillReturnScoredRecords(records, name, now);
    const meanReturnError = returnScored.length ? returnScored.reduce((sum, record) =>
      sum + Math.abs(record.expected_return_pct - record.outcome.observed_return_pct), 0) / returnScored.length : null;
    const counts = Object.fromEntries(['pending','expired','unchanged','abstained','invalid'].map(status =>
      [status, all.filter(record => skillEffectiveStatus(record, now) === status).length]));
    const calibration = Array.from({length:5}, (_, index) => {
      const bin = scored.filter(record => Math.min(4, Math.floor(record.probability_up * 5)) === index);
      return {range:`${index * 20}–${(index + 1) * 20}%`, count:bin.length,
        mean_probability:bin.length ? bin.reduce((sum, record) => sum + record.probability_up, 0) / bin.length : null,
        observed_up_rate:bin.length ? bin.filter(record => record.outcome.actual === 'up').length / bin.length : null,
        sufficient_support:bin.length >= skillSupport};
    });
    const recent = [...scored].sort((a,b) => b.outcome.at - a.outcome.at).slice(0,3);
    return {name, total:all.length, scored:scored.length, return_scored:returnScored.length,
      mean_absolute_return_error_pct:meanReturnError, ...counts, mean_brier:mean, neutral_brier:.25,
      brier_skill_pct:mean === null ? null : (.25 - mean) / .25 * 100, calibration,
      recent_errors:recent.map(record => ({symbol:record.symbol, issued_at:record.issued_at, scored_at:record.outcome.at,
        forecast_up:record.probability_up, actual:record.outcome.actual, brier:skillBrier(record),
        observed_return_pct:record.outcome.observed_return_pct,
        expected_return_pct:skillReturnValid(record.expected_return_pct) ? record.expected_return_pct : null,
        return_error_pct:skillReturnValid(record.expected_return_pct) && Number.isFinite(record.outcome.observed_return_pct) ?
          record.expected_return_pct - record.outcome.observed_return_pct : null}))};
  });
  return {policy_version:skillPolicyValid(policy) ? policy : null, prompt_version:policy === skillPolicy ? skillPrompt : null,
    model:skillModelValid(model) ? model : null, record_limit:skillLimit,
    records_retained:records.length, roles, snapshot:agentSkillSnapshot(state,model,now,policy),
    last_registration:state.agent_skills?.last_registration || null, orders_enabled:false, provider_calls:0,
    scope:'Recent retained forward forecasts for this model and policy version. Six agents share evidence and are not independent samples. Abstentions, expired labels and unchanged prices do not train directional weights. Brier accuracy is not trading profit; weights change only advisory model blending, never model parameters, orders or risk limits.'};
}
