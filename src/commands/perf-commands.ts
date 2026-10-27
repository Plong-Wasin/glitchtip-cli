// Performance data: transaction groups, spans, N+1 detection. Needs DuckDB cold
// storage on the server for everything except the transaction list.

import { api, list } from '../glitchtip/client.js';
import { projectFilter } from '../glitchtip/filters.js';
import type { NPlusOne, SpanGroup, TransactionGroup, TrendPoint } from '../glitchtip/types.js';
import { resolveProfile } from '../utils/config.js';
import { CliError } from '../utils/errors.js';
import { requireOrg, toId, toInt } from '../utils/args.js';
import { pageFooter, printFields, printJson, printTable } from '../utils/output.js';
import type { Opts } from '../utils/options.js';

const ms = (value: number | null | undefined) => (typeof value === 'number' ? Math.round(value * 10) / 10 : value);

const spanColumns = [
  { header: 'OP', get: (s: SpanGroup) => s.op },
  { header: 'COUNT', get: (s: SpanGroup) => s.count },
  { header: 'AVG MS', get: (s: SpanGroup) => ms(s.avgDuration) },
  { header: 'P95 MS', get: (s: SpanGroup) => ms(s.p95Duration) },
  { header: 'TOTAL MS', get: (s: SpanGroup) => ms(s.totalTime) },
  { header: 'DESCRIPTION', get: (s: SpanGroup) => s.description, max: 80 },
];

export async function cmdPerf(command: 'txns' | 'txn' | 'spans' | 'n1', sub: string | undefined, rest: string[], opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const project = await projectFilter(profile, org, opts);
  const range = { start: opts.since, end: opts.until };
  const limit = toInt(opts.limit, 'limit');

  if (command === 'txns') {
    const text = [sub, ...rest].filter(Boolean).join(' ') || undefined;
    const { items, next } = await list<TransactionGroup>(profile, `/api/0/organizations/${org}/transaction-groups/`, {
      project, query: text, sort: opts.sort, limit: limit ?? 25, cursor: opts.cursor, ...range,
    }, { all: opts.all });
    if (opts.json) return printJson(items);
    printTable(items, [
      { header: 'ID', get: (t) => t.id },
      { header: 'OP', get: (t) => t.op },
      { header: 'COUNT', get: (t) => t.count },
      { header: 'AVG MS', get: (t) => ms(t.avgDuration) },
      { header: 'P95 MS', get: (t) => ms(t.p95) },
      { header: 'ERRORS', get: (t) => t.errorCount },
      { header: 'TRANSACTION', get: (t) => t.transaction, max: 80 },
    ]);
    return pageFooter(items.length, 'transaction group(s)', next);
  }

  if (command === 'txn') {
    const usage = 'glitchtip txn <group-id> [trend|spans]';
    const id = toId(sub, usage);
    const base = `/api/0/organizations/${org}/transaction-groups/${id}/`;
    if (rest[0] === undefined) {
      const { data } = await api<TransactionGroup>(profile, 'GET', base);
      if (opts.json) return printJson(data);
      return printFields([
        ['Group', `#${data.id}  ${data.op}`],
        ['Transaction', data.transaction],
        ['Count', data.count],
        ['Avg / p50 / p95 ms', [ms(data.avgDuration), ms(data.p50), ms(data.p95)].join(' / ')],
        ['Errors', `${data.errorCount} (${Math.round(data.errorRate * 1000) / 10}%)`],
      ]);
    }
    if (rest[0] === 'trend') {
      const { data } = await api<TrendPoint[]>(profile, 'GET', `${base}trend/`, { query: range });
      if (opts.json) return printJson(data);
      return printTable(data, [
        { header: 'DATE', get: (p) => p.date },
        { header: 'COUNT', get: (p) => p.count },
        { header: 'AVG MS', get: (p) => ms(p.avgDuration) },
        { header: 'TOTAL MS', get: (p) => ms(p.totalTime) },
      ]);
    }
    if (rest[0] === 'spans') {
      const { data } = await api<SpanGroup[]>(profile, 'GET', `${base}spans/`, { query: range });
      if (opts.json) return printJson(data);
      return printTable(data, spanColumns);
    }
    throw new CliError(`Usage: ${usage}`, 2);
  }

  if (command === 'spans') {
    const { data } = await api<SpanGroup[]>(profile, 'GET', `/api/0/organizations/${org}/span-groups/`, {
      query: { project, op: opts.op ?? sub, sort: opts.sort, limit, ...range },
    });
    if (opts.json) return printJson(data);
    return printTable(data, spanColumns);
  }

  const threshold = opts.threshold === undefined ? undefined : Number(opts.threshold);
  if (threshold !== undefined && Number.isNaN(threshold)) throw new CliError('--threshold must be a number.', 2);
  const { data } = await api<NPlusOne[]>(profile, 'GET', `/api/0/organizations/${org}/n-plus-one/`, {
    query: { project, op: opts.op, threshold, limit, ...range },
  });
  if (opts.json) return printJson(data);
  printTable(data, [
    { header: 'SPANS/TXN', get: (n) => ms(n.spansPerTxn) },
    { header: 'TXNS', get: (n) => n.transactionCount },
    { header: 'AVG MS', get: (n) => ms(n.avgDuration) },
    { header: 'TRANSACTION', get: (n) => n.transactionName, max: 50 },
    { header: 'SPAN', get: (n) => n.description, max: 70 },
  ]);
}
