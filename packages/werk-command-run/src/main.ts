import { createCommand } from '@werk/cli';

export default createCommand({
  init: ({ commander, command }) => {
    return commander
      .description(command.description ?? '')
      .description(
        `If a script is not found in a workspace, a warning will be
        printed, but the command will complete successfully.`,
      )
      .argument('<script>', 'Script to run in each workspace.')
      .argument('[args...]', 'Arguments passed to the script.')
      .passThroughOptions();
  },

  each: async ({ log, args, workspace, spawn }) => {
    if (!workspace.selected) return;

    const [script, scriptArgs] = args;
    const { scripts } = await workspace.readPackageJson();

    if (scripts?.[script] == null) {
      log.debug(`Skipping script "${script}" because it is not defined in workspace "${workspace.name}".`);
      return;
    }

    await spawn('npm', ['run', script, ...scriptArgs], { echo: true });
  },
});
