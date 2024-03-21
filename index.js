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
    const client = github.getOctokit(authToken).rest;
    const owner = github.context.payload.pull_request.base.user.login;
    const repo = github.context.payload.pull_request.base.repo.name;

    // ensure pull request info is up to date
    const {data: pr} = await client.pulls.get({
      owner,
      repo,
      pull_number: github.context.payload.pull_request.number
    });
    const prRepo = github.context.payload.pull_request.base.repo;
    const prBranch = github.context.payload.pull_request.base.ref;
    const prUser = pr.user.login;
    const prTitle = pr.title;
    core.info(`Pull Request ${owner}/${repo}/${pr.number} on ${prBranch} by ${prUser} has title: "${prTitle}"`);

    // validate PR title
    if (prRepo.private) {
      // implement a code freeze by uncommentig these four lines
      // if (prBranch == 'main') {
      //   updateStatus(client, owner, repo, pr, GROUP_PR_TITLE, "failure", "Repo closed");
      //   return;
      // }
      // normal rules outside a code freeze
      if (isDependabot(prUser) || isOgbot(prUser)) {
        core.info("PR is from dependabot/ogbot");
        updateStatus(client, owner, repo, pr, GROUP_PR_TITLE, "success", "No need to check JIRA format - PR is from dependabot/ogbot");
      } else if (prTitle.indexOf('WIP')>= 0) {
        core.info("Branch is WIP");
        updateStatus(client, owner, repo, pr, GROUP_PR_TITLE, "pending", "Work In Progress - change PR title to enable merging");
      } else if (prTitle.startsWith('TASK: ')) {
        core.info("TASK prefix found");
        updateStatus(client, owner, repo, pr, GROUP_PR_TITLE, "failure", "PR title does not contain a valid JIRA reference");
      } else if (JIRA_PATTERN.test(prTitle)) {
        core.info("Valid JIRA format found");
        updateStatus(client, owner, repo, pr, GROUP_PR_TITLE, "success", "PR title contains JIRA reference");
        // add JIRA link
        updateJiraComment(client, owner, repo, pr);
      } else {
        core.info("Invalid title found with no JIRA");
        updateStatus(client, owner, repo, pr, GROUP_PR_TITLE, "failure", "PR title does not start with JIRA reference, eg. 'PROD-123: '");
      }
    } else {
      if (JIRA_PATTERN.test(prTitle)) {
        updateStatus(client, owner, repo, pr, GROUP_PR_TITLE, "failure", "Public repo must not refer to JIRA");
      } else {
        updateStatus(client, owner, repo, pr, GROUP_PR_TITLE, "success", "Public repo");
      }
    }

    // Approve PR if both the PR itself and its latest commit
    // were raised by a bot.
    const mostRecentCommitAuthor = pr.head.user.login
    if ([prUser, mostRecentCommitAuthor].every(login => isDependabot(login) || isOgbot(login))) {
      core.info("Approving PR and commit raised by ogbot/dependabot");
      return client.pulls.createReview({
        owner,
        repo,
        pull_number: pr.number,
        event: 'APPROVE'
      });
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
  const {data: current} = await client.repos.listCommitStatusesForRef({
    owner,
    repo,
    ref: pr.head.sha
  });
  const matched = current.find(status => status.context === group);
  if (matched && matched.state === state && matched.description === msg) {
    core.info("No need to update status");
    return;
  }
  // update the status
  core.info("Updating status to " + state);
  return client.repos.createCommitStatus({
    owner,
    repo,
    sha: pr.head.sha,
    state: state,
    description: msg,
    context: group
  });
}

//------------------------------------------------------
// check if the JIRA link has been added, and if not add it
async function updateJiraComment(client, owner, repo, pr) {
  core.info("Finding if JIRA already present")
  const currentBody = pr.body == null ? "" : pr.body;
  const jira = pr.title.match(JIRA_PATTERN)[1];
  if (jira) {
    // only update the PR if the link is not present
    const jiraLink = "https://opengamma.atlassian.net/browse/" + jira;
    if (currentBody.indexOf(jiraLink) < 0) {
      core.info(`"Adding JIRA link: ${jiraLink}`);
      const newBody = currentBody + '\n\n![og-bot](https://avatars2.githubusercontent.com/in/26131?s=20&v=4 "og-bot") See [JIRA issue](' + jiraLink + ').';
      // update the PR body
      return client.pulls.update({
        owner,
        repo,
        pull_number: pr.number,
        body: newBody
      });
    }
  }
}

//------------------------------------------------------
function isDependabot(user) {
  return user === 'dependabot[bot]' || user === 'dependabot-preview[bot]';
}

//------------------------------------------------------
function isOgbot(user) {
  return user === 'github-actions' || user === 'github-actions[bot]' || user === 'opengammacibot';
}

//------------------------------------------------------
// debug contents of an object
function dumpObjectKeys(obj) {
  var keys = Object.getOwnPropertyNames(obj);
  core.info(`Keys ${keys}`);
}

// debug methods of an object (this sometimes results in an error)
function dumpMethods(obj) {
  let properties = new Set()
  let currentObj = obj
  do {
    Object.getOwnPropertyNames(currentObj).map(item => properties.add(item))
  } while ((currentObj = Object.getPrototypeOf(currentObj)))
  let methods = [...properties.keys()].filter(item => typeof obj[item] === 'function')
  core.info(`Methods ${methods}`);
}

