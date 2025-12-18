# Contributing to SoftMaple

First off, thanks for taking the time to contribute!

The following is a set of guidelines for contributing to SoftMaple and its repos, which are hosted in the [SoftMaple Organization](https://github.com/softMaple) on GitHub. These are mostly guidelines, not rules. Use your best judgment, and feel free to propose changes to this document in a pull request.

#### Table Of Contents

[Code of Conduct](#code-of-conduct)

[How Can I Contribute?](#how-can-i-contribute)
  * [Reporting Bugs](#reporting-bugs)
  * [Suggesting Enhancements](#suggesting-enhancements)
  * [Pull Requests](#pull-requests)

[Styleguides](#styleguides)
  * [Git Commit Messages](#git-commit-messages)
  * [Code Styleguide](#code-styleguide)

## Code of Conduct

This project and everyone participating in it is governed by the [SoftMaple Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to [zhyd007@gmail.com](mailto:zhyd007@gmail.com).

## How Can I Contribute?

### Reporting Bugs

Fill [the required template](ISSUE_TEMPLATE/bug_report.md).

### Suggesting Enhancements

Fill [the required template](ISSUE_TEMPLATE/feature_request.md).

### Pull Requests

Please follow these steps to have your contribution considered by the maintainers:

1. Follow all instructions in [the template](PULL_REQUEST_TEMPLATE.md).
2. Follow the [styleguides](#styleguides).
3. Keep your branch up to date with `next` using `git rebase` (not `git merge`).

#### Keeping Your Branch Updated

When the `next` branch has new commits, update your feature branch using rebase:

```bash
# Fetch latest changes from remote
git fetch origin

# Rebase your branch onto the latest next
git rebase origin/next

# If there are conflicts, resolve them and continue
git rebase --continue

# Force push to update your branch (if already pushed)
git push --force-with-lease
```

**Why rebase instead of merge?**
- Keeps a linear, clean commit history
- Makes it easier to review changes
- Avoids unnecessary merge commits
- Simplifies bisecting and reverting changes

## Styleguides

### Git Commit Messages

Follow these types: https://github.com/angular/angular.js/blob/master/DEVELOPERS.md#type

and then append your commit message details, for example:
`docs: added community standards.`

### Code Styleguide

All JavaScript code is linted with [Prettier](https://prettier.io/).

### Branch Name Conventions

There are 2 ways to submit a PR, the normal is **Fork the repo** and another is **to be the collaborator**.

If you forked the repo and submit a PR, there is no branch name limitaion, otherwise, please use this convention: 
```bash
<username>-<app>-issue-<issue-number>
```
for example, `yadong-editor-issue-60`.

**Whatever you contributed, if the PR is merged, I will invite you as the repo collaborator.**
