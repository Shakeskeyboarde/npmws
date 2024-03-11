import nodePath from 'node:path';

import { JsonAccessor } from '@wurk/json';
import { type Log, log as defaultLog } from '@wurk/log';
import { spawn as crossSpawn } from 'cross-spawn';
import { npmRunPath } from 'npm-run-path';

import { getArgs, type LiteralArg, type SpawnSparseArgs } from './args.js';
import { SpawnExitCodeError } from './error.js';
import { quote } from './quote.js';
import { type SpawnResult } from './result.js';

type SpawnInput = Buffer | 'inherit';
type SpawnOutput = 'ignore' | 'inherit' | 'echo' | 'buffer';

export interface SpawnOptions {
  /**
   * Current working directory of the child process.
   */
  readonly cwd?: string;
  /**
   * Child process environment.
   */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Child process PATH values to be appended to the current `process.env.PATH`
   * value.
   */
  readonly paths?: readonly string[];
  /**
   * Data to write to the child process stdin.
   */
  readonly input?: SpawnInput;
  /**
   * Method of handling the output streams. Defaults to `buffer` which stores
   * stream output in memory.
   */
  readonly output?: SpawnOutput;
  /**
   * Logger to use for logging.
   */
  readonly log?: Log;
  /**
   * Print the command to the log before running it. Defaults to `true` if
   * the `output` option is `echo` or `inherit`, otherwise `false`.
   */
  readonly logCommand?:
    | boolean
    | {
      readonly mapArgs?: (
        arg: string,
      ) => boolean | string | LiteralArg | null | (string | LiteralArg)[];
    };
  /**
   * Do not throw an error if the child process exits with a non-zero status.
   */
  readonly allowNonZeroExitCode?: boolean;
}

export type Spawn = typeof spawn;

const promises: {
  readonly all: Set<Promise<unknown>>;
  blocking: Promise<unknown> | undefined;
} = {
  all: new Set(),
  blocking: undefined,
};

export const spawn = (
  cmd: string,
  sparseArgs: SpawnSparseArgs = [],
  options: SpawnOptions = {},
): Promise<SpawnResult> => {
  let promise: Promise<SpawnResult>;

  if (options.input === 'inherit' || options.output === 'inherit') {
    // If a stream is inherited, then wait for all other spawned processes to
    // complete before starting, and block new ones from spawning until this
    // process exits.
    promise = Promise.allSettled(promises.all)
      .then(async () => await spawnAsync(cmd, sparseArgs, options));

    promises.blocking = promise;

    promise.finally(() => {
      if (promises.blocking === promise) {
        promises.blocking = undefined;
      }
    })
      .catch(() => {});
  }
  else {
    // If no streams are inherited, then only wait if a previous process had
    // inherited streams.
    promise = Promise.allSettled([promises.blocking])
      .then(async () => await spawnAsync(cmd, sparseArgs, options));
  }

  promises.all.add(promise);

  promise.finally(() => {
    promises.all.delete(promise);
  })
    .catch(() => {});

  return promise;
};

const spawnAsync = async (
  cmd: string,
  sparseArgs: SpawnSparseArgs = [],
  options: SpawnOptions = {},
): Promise<SpawnResult> => {
  const {
    cwd,
    env,
    paths = [],
    input,
    output = 'buffer',
    log = defaultLog,
    logCommand = output === 'echo' || output === 'inherit',
    allowNonZeroExitCode = false,
  } = options;

  const args = getArgs(sparseArgs);

  if (logCommand) {
    const mapArgs = (typeof logCommand === 'object' && logCommand.mapArgs) || ((arg) => arg);
    const mappedArgs = args.flatMap((arg) => {
      const mappedArg = mapArgs(arg);
      return mappedArg == null
        ? []
        : typeof mappedArg === 'boolean'
          ? mappedArg
            ? arg
            : []
          : mappedArg;
    });

    log.print({
      to: 'stderr',
      prefix: output !== 'inherit',
    })`> ${quote(cmd, ...mappedArgs)}`;
  }
  else {
    log.debug`> ${quote(cmd, ...args)}`;
  }

  const cp = crossSpawn(cmd, args, {
    cwd,
    env: {
      ...process.env,
      ...env,
      PATH: [
        nodePath.dirname(process.execPath),
        npmRunPath({ cwd, path: '' }),
        env?.PATH ?? process.env.PATH,
        ...paths,
      ]
        .filter((value): value is string => Boolean(value))
        .join(nodePath.delimiter),
    },
    stdio: [
      input === 'inherit' ? 'inherit' : input != null ? 'pipe' : 'ignore',
      output === 'ignore' || output === 'inherit' ? output : 'pipe',
      output === 'ignore' || output === 'inherit' ? output : 'pipe',
    ],
  });

  // Switch the streams to flowing mode on the next tick, if they aren't
  // already, to prevent memory leaks. Not entirely sure this is
  // necessary, but I think it's better to be safe than sorry.
  process.nextTick(() => {
    cp.stdout?.resume();
    cp.stderr?.resume();
  });

  const data: { stream: 'stdout' | 'stderr'; chunk: Buffer }[] = [];

  if (output === 'buffer') {
    cp.stdout?.on('data', (chunk: Buffer) => data.push({ stream: 'stdout', chunk }));
    cp.stderr?.on('data', (chunk: Buffer) => data.push({ stream: 'stderr', chunk }));
  }
  else if (output === 'echo') {
    cp.stdout?.pipe(log.stdout);
    cp.stderr?.pipe(log.stderr);
  }

  if (input instanceof Buffer) {
    cp.stdin?.end(input);
  }

  return await new Promise<SpawnResult>((resolve, reject) => {
    cp.on('error', (error: Error & { code?: unknown }) => {
      reject(error?.code === 'ENOENT'
        ? Object.assign(new Error(`${cmd} is required`, { cause: error }), {
          code: error.code,
        })
        : error);
    });

    cp.on('close', (exitCode, signalCode) => {
      log.flush();

      exitCode ??= 1;

      if (exitCode !== 0 && !allowNonZeroExitCode) {
        if (data.length) {
          if (!logCommand) {
            log.print({ to: 'stderr' })`> ${quote(cmd, ...args)}`;
          }

          log.print({
            to: 'stderr',
            message: Buffer.concat(data.map(({ chunk }) => chunk))
              .toString('utf8')
              .trim(),
          });
        }

        reject(new SpawnExitCodeError(cmd, exitCode, signalCode));

        return;
      }

      const result: SpawnResult = {
        get stdout() {
          return Buffer.concat(data
            .filter(({ stream }) => stream === 'stdout')
            .map(({ chunk }) => chunk));
        },
        get stdoutText() {
          return result.stdout.toString('utf8')
            .trim();
        },
        get stdoutJson() {
          return JsonAccessor.parse(result.stdoutText);
        },
        get stderr() {
          return Buffer.concat(data
            .filter(({ stream }) => stream === 'stderr')
            .map(({ chunk }) => chunk));
        },
        get stderrText() {
          return result.stderr.toString('utf8')
            .trim();
        },
        get stderrJson() {
          return JsonAccessor.parse(result.stderrText);
        },
        get combined() {
          return Buffer.concat(data.map(({ chunk }) => chunk));
        },
        get combinedText() {
          return result.combined.toString('utf8')
            .trim();
        },
        exitCode,
        signalCode,
        ok: exitCode === 0,
      };

      resolve(result);
    });
  });
};

/**
 * Create a spawn function with default options.
 */
export const createSpawn = (getDefaultOptions: () => SpawnOptions): Spawn => {
  return async (cmd, args, options): Promise<SpawnResult> => {
    const defaultOptions = getDefaultOptions();

    return await spawn(cmd, args, {
      ...defaultOptions,
      ...options,
      cwd: nodePath.resolve(
        ...[defaultOptions.cwd, options?.cwd]
          .filter((value): value is string => Boolean(value)),
      ),
      env: {
        ...defaultOptions.env,
        ...options?.env,
      },
      paths: [...(defaultOptions.paths ?? []), ...(options?.paths ?? [])],
    });
  };
};
