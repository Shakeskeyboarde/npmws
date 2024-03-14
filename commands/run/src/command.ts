import { createCommand } from 'wurk';

export default createCommand('run', {
  config: (cli) => {
    return cli
      .trailer('Scripts are only run if they are present.')
      .option('<script>', 'script to run in each workspace')
      .option('[args...]', 'arguments passed to scripts')
      .setUnknownNamedOptionAllowed();
  },

  action: async ({ workspaces, options, pm }) => {
    const { script, args } = options;

    switch (pm) {
      case 'npm':
      case 'pnpm':
      case 'yarn':
        break;
      case 'yarn-classic':
        pm = 'yarn';
        break;
      default:
        throw new Error(`unsupported package manager "${pm}"`);
    }

    await workspaces.forEach(async (workspace) => {
      const { log, config, spawn } = workspace;
      const exists = config.at('scripts')
        .at(script)
        .is('string');

      if (!exists) {
        log.debug`skipping missing script "${script}"`;
        return;
      }

      await spawn(pm, ['run', '--', script, args], { stdio: 'echo' });
    });
  },
});
