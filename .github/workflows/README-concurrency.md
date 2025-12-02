# Playwright CI Concurrency Control

## Overview

This repository uses GitHub Actions concurrency controls to ensure only one Playwright test suite runs at a time across all branches and pull requests.

## How It Works

Both `playwright.yml` (E2E tests) and `playwright-smoke.yml` (smoke tests) use the same concurrency group:

```yaml
concurrency:
  group: playwright-global
  cancel-in-progress: false
```

### Behavior

1. **Single Active Runner**: Only one Playwright workflow can run at a time
2. **Queue System**: New workflow runs wait for the current one to complete
3. **No Cancellation**: Running tests are never cancelled (important for stability)
4. **Global Scope**: Applies across all branches, PRs, and workflow types

### Example Scenario

1. PR #1 triggers smoke tests → **Runs immediately**
2. PR #2 triggers E2E tests → **Queued, waits for PR #1 smoke tests**
3. PR #3 triggers smoke tests → **Queued, waits for PR #2 E2E tests**
4. Main branch push triggers E2E → **Queued, waits for PR #3**

## Benefits

- **Resource Efficiency**: Prevents parallel test runs from competing for resources
- **Cost Control**: Reduces GitHub Actions minute consumption
- **Predictable Execution**: Tests run in order of submission
- **No Test Conflicts**: Eliminates potential race conditions in shared test resources

## Considerations

- **Longer Wait Times**: PRs may wait longer for test results
- **Sequential Processing**: No parallel execution across different PRs
- **Critical Path**: A stuck test blocks all subsequent tests

## Monitoring

To see queued workflows:
1. Go to Actions tab
2. Look for workflows with "Queued" status
3. Check the concurrency message for details

## Override Options

To temporarily allow parallel execution:
1. Comment out the `concurrency` block in the workflow files
2. Or change `group` names to be unique per workflow
