import { type Log, type PackageJson, type Workspace } from '@werk/cli';
import { minVersion, satisfies } from 'semver';

interface Options {
  strict?: boolean;
}

const dependencyUpdates = new Map<string, { version: string }>();

export const addUpdate = (name: string, version: string): void => {
  dependencyUpdates.set(name, { version });
};

export const getUpdates = (): Map<string, { version: string }> => {
  return new Map(Array.from(dependencyUpdates.entries()).map(([name, { version }]) => [name, { version }]));
};

export const getUpdatePatches = (
  log: Log,
  workspace: Workspace,
  { strict = false }: Options = {},
): PackageJson | undefined => {
  let packagePatch: PackageJson | undefined;

  for (const scope of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'] as const) {
    for (const [depName, depRange] of Object.entries(workspace[scope])) {
      const update = dependencyUpdates.get(depName);

      /*
       * No update for this dependency.
       */
      if (!update) continue;

      /*
       * Not an updatable range.
       */
      if (depRange === '*' || depRange === 'x' || depRange.startsWith('file:')) continue;

      const prefix = depRange.match(/^([=^~]|>=?)?\d+(?:\.\d+(?:\.\d+(?:-[^\s|=<>^~]*)?)?)?$/u)?.[1] ?? '^';
      const newDepRange = `${prefix}${update.version}`;

      if (newDepRange === depRange) {
        continue;
      }

      /*
       * The dependency update is too small to matter and the current
       * range already satisfies it.
       */
      if (!strict && satisfies(update.version, depRange) && satisfies(update.version, `~${minVersion(depRange)}`)) {
        log.debug(`Ignoring inconsequential dependency "${depName}" update (${depRange} -> ${newDepRange}).`);
        continue;
      }

      log.debug(`Updating dependency "${depName}" (${depRange} -> ${newDepRange}).`);
      packagePatch = { ...packagePatch, [scope]: { ...packagePatch?.[scope], [depName]: newDepRange } };
    }
  }

  return packagePatch;
};
