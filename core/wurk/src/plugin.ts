import { importRelative, type ImportResult } from '@wurk/import';
import { log } from '@wurk/log';

import { type Command, isCommand } from './command.js';

const loadCommandPlugin = async (rootDir: string, packageId: string): Promise<Command | null> => {
  try {
    const { moduleExports, moduleConfig } = await importRelative(packageId, { dir: rootDir });

    if (typeof moduleExports.default !== 'function') {
      log.error(`package "${packageId}" does not export a valid command factory`);
      return null;
    }

    const command = moduleExports.default(moduleConfig) as unknown;

    if (!isCommand(command)) {
      log.error(`package "${packageId}" command factory returned an invalid command`);
      return null;
    }

    return command;
  } catch (error) {
    log.error(`loading command package "${packageId}" threw the following error:`);
    log.error(error);
    return null;
  }
};

export const loadCommandPlugins = async (
  rootDir: string,
  rootPackage: ImportResult['moduleConfig'],
): Promise<Command[]> => {
  const explicitPackageIds = rootPackage
    .at('wurk')
    .at('commands')
    .as('array', [] as unknown[])
    .filter((value): value is string => typeof value === 'string');

  const packageIds = Array.from(
    new Set([
      ...[
        ...rootPackage.at('dependencies').keys('object'),
        ...rootPackage.at('devDependencies').keys('object'),
        ...rootPackage.at('peerDependencies').keys('object'),
        ...rootPackage.at('optionalDependencies').keys('object'),
      ].filter((packageId) => /^(?:(?:.*\/)?w[eu]rk-command-|@(?:werk|wurk)\/command-).*$/u.test(packageId)),
      ...explicitPackageIds,
    ]),
  ).sort();

  const commands = await Promise.all(packageIds.map((packageId) => loadCommandPlugin(rootDir, packageId)));

  return commands.filter((value): value is Command => value != null);
};
