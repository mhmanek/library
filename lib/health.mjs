// Per-source health with grace periods, so one-off blips never email him: a run fails (and GitHub emails) only
// once a source has been failing longer than its grace, then at most weekly. A manual run reports a Goodreads
// failure at once, because he is watching. State changes only on transitions, so sync.json stays quiet.
export const GRACE_HOURS = {goodreads: 12, substack: 72, wall: 24};
const HOUR = 36e5, DAY = 24 * HOUR;
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// prev: {source: {changedAt, failingSince, notifiedAt}}; outcomes: {source: {ok, skipped?}}
export function updateHealth(prev = {}, outcomes = {}, now = Date.now(), {interactive = false} = {}) {
  const sources = {}, alerts = [];
  for (const source of Object.keys(GRACE_HOURS)) {
    const p = {changedAt: null, failingSince: null, notifiedAt: null, ...(prev[source] ?? {})};
    const o = outcomes[source];
    if (!o || o.skipped) { sources[source] = p; continue; }
    if (o.ok) { sources[source] = {...p, failingSince: null, notifiedAt: null}; continue; }
    const failingSince = p.failingSince ?? iso(now);
    const failingHours = (now - Date.parse(failingSince)) / HOUR;
    const quiet = p.notifiedAt && now - Date.parse(p.notifiedAt) < 7 * DAY;
    const due = (interactive && source === 'goodreads') || (failingHours >= GRACE_HOURS[source] && !quiet);
    sources[source] = {...p, failingSince, notifiedAt: due ? iso(now) : p.notifiedAt};
    if (due) alerts.push({source, code: o.error?.code ?? 'unknown', since: failingSince, hours: Math.floor(failingHours)});
  }
  return {sources, alerts};
}
