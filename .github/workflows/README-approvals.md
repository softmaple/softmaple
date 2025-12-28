# Playwright Test Approval System

## Overview

This repository requires approval before running Playwright E2E and smoke tests to ensure controlled test execution and prevent unintended resource consumption.

## How It Works

Both `playwright.yml` (E2E tests) and `playwright-smoke.yml` (smoke tests) include approval gates:

### Approval Jobs

```yaml
approve:
  name: Approve Test Run
  environment: apps/web-e2e  # or apps/web-e2e-smoke
  steps:
    - name: Request approval
      run: echo "✅ Tests approved for execution"
```

### GitHub Environments Required

Two environments need to be configured in GitHub repository settings:

1. **`apps/web-e2e`** - For full E2E test suite
2. **`apps/web-e2e-smoke`** - For smoke tests

### Setting Up Environments

1. Go to Settings → Environments
2. Create new environment: `apps/web-e2e`
3. Add protection rules:
   - ✅ Required reviewers: Add team members or specific users
   - Optional: Wait timer (delays execution after approval)
4. Repeat for `apps/web-e2e-smoke`

## Workflow Behavior

### Standard Flow
1. PR or push triggers workflow
2. Approval job requests permission
3. Designated reviewers get notification
4. Once approved, tests run
5. If rejected, workflow stops

### Manual Workflow Dispatch

Manual workflow dispatch also requires approval - there is no bypass option.
All test runs must go through the approval process.

## Benefits

- **Resource Control**: Prevents unnecessary test runs
- **Cost Management**: Reduces GitHub Actions minutes
- **Quality Gate**: Ensures tests run only when ready
- **Audit Trail**: GitHub tracks who approved each run

## Approval Process

### For Reviewers

1. Go to Actions tab
2. Click on the waiting workflow
3. Click "Review deployments"
4. Select environment to approve
5. Add comment (optional)
6. Click "Approve and deploy"

### For Developers

- Your workflow will show as "Waiting" status
- You'll be notified once approved
- Tests run automatically after approval

## Considerations

- **PR Reviews**: Consider if PR already reviewed before requiring test approval
- **Time Zones**: Ensure reviewers cover different time zones
- **No Bypass**: All test runs require approval, even manual triggers

## Monitoring

To view approval history:
1. Go to Settings → Environments
2. Click on environment name
3. View "Deployment history" for approval records

## Troubleshooting

### Tests Not Running After Approval
- Check if concurrency queue is blocking (see README-concurrency.md)
- Verify environment protection rules are correctly configured
- Ensure approver has required permissions

### Can't Find Approval Request
- Check Actions tab for "Waiting" workflows
- Verify you're added as a reviewer in environment settings
- Check notification settings in GitHub profile
