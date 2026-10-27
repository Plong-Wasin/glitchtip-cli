// Human-readable views of API objects. `--json` always shows the raw object.

import type { Issue, IssueEvent } from '../glitchtip/types.js';
import { printFields, shortDate } from './output.js';

interface Frame {
  filename?: string;
  absPath?: string;
  lineNo?: number;
  function?: string;
  module?: string;
  inApp?: boolean;
  context?: [number, string][];
}

interface ExceptionValue {
  type?: string;
  value?: string;
  stacktrace?: { frames?: Frame[] } | null;
}

export function printIssue(issue: Issue): void {
  printFields([
    ['Issue', `#${issue.id}  ${issue.shortId}`],
    ['Title', issue.title],
    ['Culprit', issue.culprit],
    ['Status', `${issue.status}  (${issue.level})`],
    ['Project', issue.project.slug ?? issue.project.name],
    ['Events', `${issue.count} events, ${issue.userCount ?? 0} users, ${issue.numComments} comments`],
    ['First seen', `${shortDate(issue.firstSeen)}${issue.firstRelease?.version ? `  in ${issue.firstRelease.version}` : ''}`],
    ['Last seen', `${shortDate(issue.lastSeen)}${issue.lastRelease?.version ? `  in ${issue.lastRelease.version}` : ''}`],
    ['URL', issue.permalink],
  ]);
}

function printFrame(frame: Frame): void {
  const where = `${frame.absPath ?? frame.filename ?? frame.module ?? '?'}${frame.lineNo ? `:${frame.lineNo}` : ''}`;
  console.log(`  ${frame.inApp ? '*' : ' '} ${where}${frame.function ? ` in ${frame.function}` : ''}`);
  const code = frame.context?.find(([line]) => line === frame.lineNo)?.[1];
  if (code !== undefined) console.log(`        > ${code.trim()}`);
}

// Sentry-style frames run oldest first, so the failing call is the last one.
// By default only application frames (inApp) are shown, the useful part when triaging.
function printException(value: ExceptionValue, allFrames: boolean): void {
  console.log(`\nException: ${value.type ?? 'Error'}: ${value.value ?? ''}`);
  const frames = value.stacktrace?.frames ?? [];
  if (frames.length === 0) return;
  const app = frames.filter((frame) => frame.inApp);
  const shown = allFrames ? frames : app.length > 0 ? app : frames.slice(-5);
  const hidden = frames.length - shown.length;
  console.log(`  (most recent call last; * = in-app${hidden > 0 ? `; ${hidden} other frame(s) hidden, --all-frames shows them` : ''})`);
  for (const frame of shown) printFrame(frame);
}

export function printEvent(event: IssueEvent, options: { allFrames?: boolean } = {}): void {
  printFields([
    ['Title', event.title],
    ['Event', `${event.eventID}  ${shortDate(event.dateCreated)}${event.platform ? `  ${event.platform}` : ''}`],
    ['Issue', `#${event.groupID}`],
    ['Message', event.message && event.message !== event.title ? event.message : undefined],
    ['User', event.user ? [event.user.email, event.user.username, event.user.id, event.user.ip_address].filter(Boolean).join(' ') : undefined],
    ['Tags', event.tags?.length ? event.tags.map((t) => `${t.key}=${t.value}`).join('  ') : undefined],
  ]);

  for (const entry of event.entries ?? []) {
    if (entry.type === 'exception') {
      const values = (entry.data as { values?: ExceptionValue[] } | null)?.values ?? [];
      for (const value of values) printException(value, Boolean(options.allFrames));
    } else if (entry.type === 'request') {
      const request = entry.data as { method?: string; url?: string } | null;
      if (request?.url) console.log(`\nRequest: ${request.method ?? ''} ${request.url}`.replace('  ', ' '));
    }
  }
}
