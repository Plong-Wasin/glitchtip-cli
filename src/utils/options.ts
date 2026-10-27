// Every flag the CLI accepts. Commands read them from `Opts`.
export const OPTIONS = {
  profile: { type: 'string', short: 'p' },
  org: { type: 'string' },
  project: { type: 'string' },
  'project-id': { type: 'string' },
  env: { type: 'string', short: 'e' },
  json: { type: 'boolean' },
  all: { type: 'boolean' },
  query: { type: 'string', short: 'q' },
  sort: { type: 'string' },
  since: { type: 'string' },
  until: { type: 'string' },
  limit: { type: 'string', short: 'n' },
  level: { type: 'string' },
  service: { type: 'string' },
  host: { type: 'string' },
  trace: { type: 'string' },
  op: { type: 'string' },
  threshold: { type: 'string' },
  'next-release': { type: 'boolean' },
  release: { type: 'string' },
  args: { type: 'string' },
  url: { type: 'string' },
  token: { type: 'string' },
  manual: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

export type Opts = {
  -readonly [K in keyof typeof OPTIONS]?: (typeof OPTIONS)[K]['type'] extends 'boolean' ? boolean : string;
};
