'use strict';

/**
 * prepare-release — bump version, generate changelog, update welcome screen.
 *
 * Usage:
 *   npm run prepare-release -- --version 3.0.0
 *   npm run prepare-release -- --version 3.0.0 --no-push
 */

const { execSync } = require('child_process');
const { readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');

const REPO_ROOT = resolve(__dirname, '..');
const GITLAB_PROJECT = 'dragonshorn%2FD35E';

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

function hasFlag(flag) {
  return args.includes(flag);
}

const version = getArg('--version') || getArg('-v');
const noPush     = hasFlag('--no-push') || hasFlag('-n');
const noCommit   = hasFlag('--no-commit');

if (!version) {
  console.error('Error: --version is required');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', ...opts }).trim();
}

function glabApi(path) {
  const raw = run(`glab api --paginate "projects/${GITLAB_PROJECT}/${path}"`);
  // --paginate concatenates pages as ][  — merge into a single valid array.
  return JSON.parse(raw.trim().replace(/\]\s*\[/g, ','));
}

function gitAdd(...paths) {
  run(`git add ${paths.map(p => `"${p}"`).join(' ')}`);
}

// ── Bump version.yaml ─────────────────────────────────────────────────────────

writeFileSync(
  resolve(REPO_ROOT, 'version.yaml'),
  `variables:\n    VERSION: '${version}'\n`,
  'utf8'
);
console.log('Updated version.yaml');

// ── Bump system.json ──────────────────────────────────────────────────────────

const systemJsonPath = resolve(REPO_ROOT, 'system.json');
const systemJson = JSON.parse(readFileSync(systemJsonPath, 'utf8'));
systemJson.version = version;
writeFileSync(systemJsonPath, JSON.stringify(systemJson, null, 4), 'utf8');
gitAdd('system.json');
console.log('Updated system.json');

// ── Fetch milestone issues via glab ───────────────────────────────────────────

const milestones = glabApi(`milestones?title=${encodeURIComponent(version)}`);
if (!milestones.length) {
  console.error(`Error: no milestone found with title "${version}"`);
  process.exit(1);
}
const milestoneId = milestones[0].id;
const issues = glabApi(`milestones/${milestoneId}/issues`);

// ── Build changelog ───────────────────────────────────────────────────────────

const closedIssues = issues.filter(i => i.state === 'closed');

let changelogMd = '# Issues fixed\n';
let changelogHtml = `<!-- ${version} -->\n<h2>${version}</h2>\n<h3>Changes</h3>\n<ul>\n`;

for (const issue of closedIssues) {
  const url = `https://gitlab.com/dragonshorn/D35E/-/issues/${issue.iid}`;
  changelogMd  += `- [#${issue.iid}](${url}) - ${issue.title}\n`;
  changelogHtml += `<li> <a href='${url}'>#${issue.iid}</a> - ${issue.title} </li>\n`;
}
changelogHtml += '</ul>\n';

const changelogPath = resolve(REPO_ROOT, `changelogs/changelog.${version}.md`);
writeFileSync(changelogPath, changelogMd, 'utf8');
gitAdd(`changelogs/changelog.${version}.md`);
console.log(`Created changelogs/changelog.${version}.md`);

// ── Inject into welcome screen ────────────────────────────────────────────────

const welcomePath = resolve(REPO_ROOT, 'templates/welcome-screen.html');
let welcome = readFileSync(welcomePath, 'utf8');

if (welcome.includes(`<!-- ${version} -->`)) {
  console.log(`Version ${version} already added to Welcome Screen`);
} else {
  welcome = welcome.replace(
    '<!-- NEW VERSION FIELD -->',
    `<!-- NEW VERSION FIELD -->\n${changelogHtml}`
  );
  writeFileSync(welcomePath, welcome, 'utf8');
}
gitAdd('templates/welcome-screen.html');
gitAdd('version.yaml');
gitAdd('source');

// ── Commit & push ─────────────────────────────────────────────────────────────

if (!noCommit) {
  run(`git commit -m "Release ${version}"`);
  console.log(`Committed release ${version}`);

  if (!noPush) {
    run('git push');
    console.log('Pushed');
  }
} else {
  console.log('Skipping commit (--no-commit)');
}
