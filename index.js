const core = require('@actions/core');
const github = require('@actions/github');

const validEvent = ['pull_request'];

const JIRA_PATTERN = /^([A-Z]+-\d+): .*$/;

function isDependabot(user) {
  return user === 'dependabot[bot]' || user === 'dependabot-preview[bot]';
}

function isOgbot(user) {
  return user === 'opengammacibot';
}

async function run() {
    try {
		// get basic info
        const eventName = github.context.eventName;
        core.info(`Event name: ${eventName}`);
        if (validEvent.indexOf(eventName) < 0) {
            core.setFailed(`Invalid event: ${eventName}`);
            return;
        }
        const authToken = core.getInput('token', {required: true})
        const client = new github.GitHub(authToken);
        const owner = github.context.payload.pull_request.base.user.login;
        const repo = github.context.payload.pull_request.base.repo.name;

		// ensure pull request info is up to date
        const {data: pullRequest} = await client.pulls.get({
          owner,
          repo,
          pull_number: github.context.payload.pull_request.number
        });
        const prUser = pullRequest.user.login;
        const prTitle = pullRequest.title;
        core.info(`Pull Request ${repo}/${pullRequest.number} has title: "${prTitle}"`);

        // validate
        if (isDependabot(prUser) || isOgbot(prUser)) {
          core.info("JIRA: PR is from dependabot/ogbot");
        } else if (prTitle.indexOf('WIP')>= 0) {
          core.info("JIRA: Branch is WIP");
		  core.setFailed("PR title indicates WIP (Work In Progress)");
        } else if (prTitle.startsWith('TASK: ')) {
          core.info("JIRA: TASK prefix found");
        } else if (JIRA_PATTERN.test(prTitle)) {
          core.info("JIRA: Valid JIRA format found");
        } else {
          core.info("JIRA: Invalid title found with no JIRA");
		  core.setFailed("PR title does not start with JIRA reference, eg. 'PROD-123: '");
        }
		return;

    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
