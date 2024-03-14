import { Cli, type CliName, type EmptyResult } from '@wurk/cli';
import { type JsonAccessor } from '@wurk/json';
import { type PackageManagerId } from '@wurk/pm';
import { type Workspace, type Workspaces } from '@wurk/workspace';

import { CommandContext } from './context.js';

/**
 * Configuration callback for a Wurk command plugin.
 */
export type CommandConfigCallback<
  TResult extends EmptyResult,
  TName extends string,
> = (cli: Cli<EmptyResult, TName>, config: JsonAccessor) => Cli<TResult, TName>;

/**
 * Action callback for a Wurk command plugin.
 */
export type CommandActionCallback<TResult extends EmptyResult = EmptyResult> = (
  context: CommandContext<TResult>,
) => Promise<void>;

/**
 * Configuration for a Wurk command plugin.
 */
export interface CommandHooks<
  TResult extends EmptyResult,
  TName extends string,
> {
  /**
   * Configure command line options.
   */
  readonly config?: CommandConfigCallback<TResult, TName>;

  /**
   * Command implementation.
   */
  readonly action: CommandActionCallback<TResult>;
}

export interface Command<
  TResult extends EmptyResult = EmptyResult,
  TName extends string = string,
> {
  readonly cli: Cli<TResult, TName>;
  readonly init: (config: InitConfig) => void;
}

interface InitConfig {
  readonly root: Workspace;
  readonly workspaces: Workspaces;
}

/**
 * Create a Wurk command plugin.
 *
 * @example
 * ```ts
 * export default createCommand('my-command', {
 *   config: (cli) => {
 *     // Configure command line options (optional).
 *     return cli.option('-f, --foo <value>', 'Foo option');
 *   },
 *   action: async (context) => {
 *     // Iterate over workspaces, spawn processes, modify files, etc.
 *     context.workspaces.forEach(async (workspace) => {
 *       // Do something with each selected workspace.
 *     });
 *   },
 * });
 * ```
 *
 * @returns A Wurk command plugin. The type is `unknown` because its not
 * intended for direct use, and exporting the type would complicate typescript
 * type declaration output.
 */
export const createCommand = <
  TName extends string,
  TResult extends EmptyResult,
>(
  name: CliName<TName>,
  hooks: CommandHooks<TResult, TName> | CommandActionCallback,
): unknown => {
  return new CommandFactory((config, pm) => {
    let initConfig: InitConfig | undefined;

    const {
      config: configHook = (value: unknown) => value as Cli<TResult, TName>,
      action: actionHook,
    } = typeof hooks === 'function'
      ? { action: hooks as CommandActionCallback<TResult> }
      : hooks;

    const cli = configHook(
      Cli.create(name)
        .description(config
          .at('description')
          .as('string'))
        .version(config
          .at('version')
          .as('string'))
        .optionHelp()
        .optionVersion(),
      config,
    )
      .action(async (result) => {
        if (!initConfig) throw new Error('command not initialized');

        const { root, workspaces } = initConfig;
        const context = new CommandContext({ result, root, workspaces, pm });

        await actionHook(context);
      });

    const init = (newInitConfig: InitConfig): void => {
      initConfig = newInitConfig;
    };

    return { cli, init };
  });
};

export class CommandFactory<
  TResult extends EmptyResult = EmptyResult,
  TName extends string = string,
> {
  constructor(
    readonly load: (config: JsonAccessor, pm: PackageManagerId) => Command<TResult, TName>,
  ) {}
}
