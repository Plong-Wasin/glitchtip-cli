// An expected failure: the message is printed as `glitchtip: <message>` and the
// process exits with `exitCode` (1 = server/tool error, 2 = usage error).
export class CliError extends Error {
  exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}
