const core = require('@actions/core');
const github = require('@actions/github');

const validEvent = ['pull_request'];

const GROUP_PR_TITLE = 'ogbot PR title';
const JIRA_PATTERN = /^([A-Z]+-\d+): .*$/;

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
        const {data: pr} = await client.pulls.get({
          owner,
          repo,
          pull_number: github.context.payload.pull_request.number
        });
        const prUser = pr.user.login;
        const prTitle = pr.title;
        core.info(`Pull Request ${owner}/${repo}/${pr.number} has title: "${prTitle}"`);

        // validate
        if (isDependabot(prUser) || isOgbot(prUser)) {
          core.info("JIRA: PR is from dependabot/ogbot");
		  updateStatus(client, owner, repo, pr, GROUP_PR_TITLE, "success", "No need to check JIRA format - PR is from dependabot/ogbot");
        } else if (prTitle.indexOf('WIP')>= 0) {
          core.info("JIRA: Branch is WIP");
		  updateStatus(client, owner, repo, pr, GROUP_PR_TITLE, "pending", "Work In Progress - change PR title to enable merging");
        } else if (prTitle.startsWith('TASK: ')) {
          core.info("JIRA: TASK prefix found");
		  updateStatus(client, owner, repo, pr, GROUP_PR_TITLE, "success", "WARNING! Use of 'TASK' prefix is not currently recommended");
        } else if (JIRA_PATTERN.test(prTitle)) {
          core.info("JIRA: Valid JIRA format found");
		  updateStatus(client, owner, repo, pr, GROUP_PR_TITLE, "success", "PR title contains JIRA reference");
        } else {
          core.info("JIRA: Invalid title found with no JIRA");
		  updateStatus(client, owner, repo, pr, GROUP_PR_TITLE, "failure", "PR title does not start with JIRA reference, eg. 'PROD-123: '");
        }

    } catch (error) {
        core.setFailed(error.message);
    }
}

run();

//------------------------------------------------------
// checks and updates the status
async function updateStatus(client, owner, repo, pr, group, state, msg) {
  // query the current status and check if we need to make a change
  // this avoids repeatedly updating the status when it hasn't changed
  // (GitHub stores each update immutably as a new status)
  const {data: current} = await client.repos.listStatusesForRef({
    owner,
    repo,
    ref: pr.head.sha
  });
  
//  const current = (await github.repos.listStatusesForRef(context.repo({ref: pr.head.sha}))).data;
  const matched = current.find(status => status.context === group);
  if (matched && matched.state === state && matched.description === msg) {
    core.info("No need to update status on GitHub");
    return;
  }
  // update the status
  core.info("Update status on GitHub to " + state);
  return client.repos.createStatus({
    owner,
    repo,
    sha: pr.head.sha,
    state: state,
    description: msg,
    context: group
  });
}

//------------------------------------------------------
function isDependabot(user) {
  return user === 'dependabot[bot]' || user === 'dependabot-preview[bot]';
}

//------------------------------------------------------
function isOgbot(user) {
  return user === 'opengammacibot';
}

