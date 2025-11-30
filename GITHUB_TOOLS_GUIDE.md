# 🛠️ GitHub Tools & Automation Guide

This guide explains all the GitHub tools and automations configured for the Liftoff project.

---

## 📋 Table of Contents

1. [Issue Templates](#issue-templates)
2. [Pull Request Template](#pull-request-template)
3. [Dependabot](#dependabot)
4. [Automated Releases](#automated-releases)
5. [Branch Protection](#branch-protection)
6. [Claude AI Integration](#claude-ai-integration)
7. [CI/CD Pipeline](#cicd-pipeline)

---

## 🎫 Issue Templates

**Location:** `.github/ISSUE_TEMPLATE/`

We have structured issue templates to ensure consistent bug reports and feature requests.

### Bug Reports

When creating a bug report, users are prompted for:
- Clear bug description
- Steps to reproduce
- Expected vs actual behavior
- Error logs from Output panel
- Extension & VS Code versions
- Operating system
- Additional context

**Usage:**
```
1. Go to: https://github.com/fattits30-dev/liftoff/issues/new/choose
2. Select "🐛 Bug Report"
3. Fill out the form
4. Submit
```

**Auto-labels:** `bug`, `needs-triage`

### Feature Requests

When requesting a feature, users provide:
- Problem statement (what need does this address?)
- Proposed solution
- Alternative approaches considered
- Feature category (App Builder, Agent System, etc.)
- Priority level
- Example use cases
- Mockups or references

**Usage:**
```
1. Go to: https://github.com/fattits30-dev/liftoff/issues/new/choose
2. Select "✨ Feature Request"
3. Fill out the form
4. Submit
```

**Auto-labels:** `enhancement`, `needs-triage`

### Issue Template Config

The `.github/ISSUE_TEMPLATE/config.yml` file adds helpful links:
- GitHub Discussions for Q&A
- Documentation
- Claude AI integration guide

---

## 📝 Pull Request Template

**Location:** `.github/pull_request_template.md`

Every PR automatically includes a comprehensive template with:

**Sections:**
- Description of changes
- Related issues (with auto-linking)
- Type of change (bug fix, feature, breaking change, etc.)
- Testing details and scenarios
- Screenshots/demos
- Comprehensive checklist covering:
  - Code quality (ESLint, TypeScript, comments)
  - Documentation updates
  - Testing (unit, integration, edge cases)
  - Git hygiene (commit messages, rebasing)
  - Dependencies (justified additions, sync check)
- Deployment notes
- AI review acknowledgment
- Additional notes for reviewers

**Best Practices:**
- Fill out ALL sections before requesting review
- Mark completed checklist items with `[x]`
- Link related issues with `Fixes #123` or `Closes #456`
- Add screenshots for UI changes
- Address Claude's automated review before human review

---

## 🤖 Dependabot

**Location:** `.github/dependabot.yml`

Dependabot automatically creates PRs for dependency updates.

**Configuration:**
- **Schedule:** Weekly on Mondays at 9:00 AM
- **Max PRs:** 5 open at a time
- **Auto-labels:** `dependencies`, `automated`
- **Reviewers:** @fattits30-dev
- **Grouped updates:**
  - Dev dependencies (minor + patch)
  - Production dependencies (minor + patch)
  - Major updates are separate PRs

**What's Monitored:**
1. **npm packages** (`package.json`)
   - TypeScript, ESLint, test frameworks
   - Runtime dependencies (uuid, playwright)
2. **GitHub Actions** (`.github/workflows/*.yml`)
   - actions/checkout, actions/setup-node, etc.

**Workflow:**
1. Dependabot creates PR every Monday
2. CI runs automatically
3. Claude reviews the changes
4. You review & merge (or close if not needed)

**Tips:**
- Merge security updates ASAP
- Group non-critical updates monthly
- Test locally if update affects core functionality

---

## 🚀 Automated Releases

**Location:** `.github/workflows/release.yml`

Automated release creation when you push a version tag.

### How to Create a Release

**Step 1: Update Version**
```bash
# Edit package.json
# Change "version": "0.1.0" to "0.2.0"
```

**Step 2: Update CHANGELOG.md (Optional)**
```markdown
## [0.2.0] - 2025-12-01

### Added
- New app builder feature
- Improved test generation

### Fixed
- Agent tab switching bug
- Python syntax validation

### Changed
- Updated HuggingFace integration
```

**Step 3: Commit and Tag**
```bash
git add package.json CHANGELOG.md
git commit -m "Release v0.2.0"
git tag v0.2.0
git push origin main
git push origin v0.2.0
```

**Step 4: Automatic Process**
1. GitHub Actions builds the VSIX
2. Creates GitHub Release with:
   - VSIX file attached
   - Changelog extracted
   - Installation instructions
   - Links to docs
3. Marks as prerelease if version contains `-` (e.g., `v0.2.0-beta`)

### After Release

**Manual Step: Publish to VS Code Marketplace**

The workflow prepares the VSIX but doesn't auto-publish (requires marketplace token).

To publish manually:
1. Download VSIX from GitHub Release
2. Go to: https://marketplace.visualstudio.com/manage
3. Upload VSIX file
4. Publish

**To Automate (Future):**
```yaml
# Add to .github/workflows/release.yml
- name: Publish to Marketplace
  run: npx @vscode/vsce publish -p ${{ secrets.VSCE_TOKEN }}
  env:
    VSCE_TOKEN: ${{ secrets.VSCE_TOKEN }}
```

Then add `VSCE_TOKEN` to GitHub secrets.

---

## 🛡️ Branch Protection

**Status:** ⚠️ Manual Setup Required

Branch protection prevents direct pushes to main and enforces quality checks.

### Recommended Settings

**For `main` branch:**

1. **Require Pull Requests:**
   - ✅ Require approvals: 1
   - ✅ Dismiss stale reviews when new commits are pushed
   - ✅ Require review from Code Owners (optional)

2. **Require Status Checks:**
   - ✅ Require branches to be up to date
   - **Required checks:**
     - `Lint & Type Check`
     - `Security Scan`
     - `Build Extension`

3. **Require Conversation Resolution:**
   - ✅ Require all comments to be resolved before merging

4. **Other Settings:**
   - ✅ Do not allow bypassing the above settings
   - ✅ Restrict who can push to matching branches (optional)
   - ❌ Allow force pushes (disabled)
   - ❌ Allow deletions (disabled)

### Setup Instructions

**Via GitHub Web UI:**
1. Go to: https://github.com/fattits30-dev/liftoff/settings/branches
2. Click "Add branch protection rule"
3. Branch name pattern: `main`
4. Configure settings as above
5. Click "Create"

**Via GitHub CLI:**
```bash
gh api repos/fattits30-dev/liftoff/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["Lint & Type Check","Security Scan","Build Extension"]}' \
  --field enforce_admins=true \
  --field required_pull_request_reviews='{"required_approving_review_count":1,"dismiss_stale_reviews":true}' \
  --field restrictions=null
```

**For Development Branch (`develop`):**
- Same settings but allow self-approval
- Or no protection if you're the only dev

---

## 🤖 Claude AI Integration

**Already Configured!** 🎉

Since you've added the `ANTHROPIC_API_KEY`, Claude is now active.

### What Claude Does

**1. Automated PR Reviews:**
- Triggers: Every PR to `main` or `develop`
- Analyzes: Code quality, security, performance, best practices
- Posts: Detailed review comment with issues/suggestions
- Checks: TypeScript patterns, VS Code guidelines, async/await

**2. Issue Analysis:**
- Triggers: Issues labeled `needs-analysis`, `bug`, or `enhancement`
- Provides:
  - **For bugs:** Root cause, reproduction steps, fix suggestions, file locations
  - **For features:** Design approach, architecture impact, edge cases, testing strategy

**3. GitHub MCP (in Claude Code):**
- You can use Claude Code CLI to:
  - Create/update issues: "Create issue for dark mode feature"
  - Review PRs: "Summarize PR #42"
  - List tasks: "Show all open bugs"
  - Search code: "Find all GraphQL queries"

### Testing Claude Integration

**Test PR Review:**
```bash
git checkout -b test-claude-review
echo "// test change" >> README.md
git commit -am "Test Claude review"
git push origin test-claude-review
gh pr create --title "Test" --body "Testing Claude AI review"

# Wait ~30 seconds, then:
gh pr view --comments
```

**Test Issue Analysis:**
```bash
gh issue create \
  --title "Add dark mode support" \
  --body "Users want dark mode for the app builder UI" \
  --label "enhancement,needs-analysis"

# Wait ~20 seconds, then:
gh issue view --comments
```

---

## 🔄 CI/CD Pipeline

**Location:** `.github/workflows/ci.yml`

Runs on every push and pull request.

### Jobs

**1. Lint & Type Check** (19s)
- ESLint (warnings allowed, errors fail)
- TypeScript compilation
- Runs on: Ubuntu with Node 20

**2. Security Scan** (22s)
- npm audit (moderate level)
- Trivy vulnerability scanner
- Uploads SARIF to GitHub Security tab
- Always runs (even if other jobs fail)

**3. Build Extension** (35s)
- Compiles TypeScript
- Packages VSIX with vsce
- Uploads artifact (liftoff-extension.vsix)
- Available for 30 days

**4. All Checks Pass** (2s)
- Verifies all required jobs succeeded
- Used as branch protection requirement

### Viewing CI Results

**GitHub Web UI:**
```
https://github.com/fattits30-dev/liftoff/actions
```

**GitHub CLI:**
```bash
# List recent runs
gh run list --limit 5

# View specific run
gh run view 19800763395

# Watch live
gh run watch

# View logs
gh run view --log
```

---

## 📊 GitHub Insights & Tools

### Additional Useful Tools

**1. GitHub Projects**
- Create kanban boards for tracking work
- Link issues/PRs automatically
- https://github.com/fattits30-dev/liftoff/projects

**2. GitHub Discussions**
- Enable for Q&A, ideas, announcements
- https://github.com/fattits30-dev/liftoff/settings
- Check "Discussions" under Features

**3. Code Owners (`.github/CODEOWNERS`)**
```
# Auto-assign reviewers based on file paths
*.ts @fattits30-dev
/src/appBuilder/ @app-builder-team
/docs/ @docs-team
```

**4. GitHub Wiki**
- For comprehensive documentation
- https://github.com/fattits30-dev/liftoff/wiki

**5. Security Advisories**
- Private disclosure of vulnerabilities
- https://github.com/fattits30-dev/liftoff/security/advisories

**6. Insights Dashboard**
- Contributors, commit activity, traffic
- https://github.com/fattits30-dev/liftoff/pulse

---

## 🎯 Recommended Workflow

**For New Features:**
1. Create issue with feature template
2. Wait for Claude's analysis (~20s)
3. Review design suggestions
4. Create branch: `feature/your-feature`
5. Implement feature
6. Push and create PR
7. Wait for CI + Claude review (~1 min)
8. Address feedback
9. Request human review
10. Merge when approved

**For Bug Fixes:**
1. Create issue with bug template
2. Wait for Claude's analysis
3. Review root cause suggestions
4. Create branch: `fix/bug-description`
5. Implement fix
6. Add regression test
7. Push and create PR
8. Verify CI passes
9. Address Claude's review
10. Merge

**For Releases:**
1. Update version in package.json
2. Update CHANGELOG.md
3. Commit: "Release v0.2.0"
4. Tag: `git tag v0.2.0`
5. Push: `git push origin main --tags`
6. Wait for automated release
7. Download VSIX from GitHub Release
8. Manually publish to VS Code Marketplace (optional)

---

## 🔧 Maintenance

### Weekly Tasks
- Review Dependabot PRs
- Merge security updates
- Close stale issues

### Monthly Tasks
- Review CI performance
- Update documentation
- Check security advisories

### Quarterly Tasks
- Review branch protection settings
- Audit access permissions
- Update Claude integration settings

---

## 🆘 Troubleshooting

**Issue: Dependabot not creating PRs**
- Check: `.github/dependabot.yml` syntax
- Verify: Schedule time vs your timezone
- Check: https://github.com/fattits30-dev/liftoff/network/updates

**Issue: CI failing unexpectedly**
- Check: https://github.com/fattits30-dev/liftoff/actions
- View logs: `gh run view --log`
- Rerun: `gh run rerun`

**Issue: Claude not reviewing PRs**
- Verify: `ANTHROPIC_API_KEY` secret exists
- Check: `.github/workflows/claude-pr-review.yml`
- Check: PR targets `main` or `develop` branch

**Issue: Release workflow not triggering**
- Verify: Tag format is `v*.*.*` (e.g., v1.0.0)
- Check: Tag pushed to remote (`git push --tags`)
- View: https://github.com/fattits30-dev/liftoff/releases

---

## 📚 Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Dependabot Documentation](https://docs.github.com/en/code-security/dependabot)
- [Branch Protection Rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)
- [GitHub CLI Manual](https://cli.github.com/manual/)
- [Claude GitHub Integration](./CLAUDE_GITHUB_INTEGRATION.md)

---

## 🎉 Summary

You now have a complete GitHub automation setup:

✅ **Issue templates** for structured bug reports and feature requests
✅ **PR template** for consistent pull request format
✅ **Dependabot** for automated dependency updates
✅ **Automated releases** with VSIX artifacts
✅ **CI/CD pipeline** with linting, security scans, and builds
✅ **Claude AI integration** for automated code reviews and issue analysis

**Next: Configure branch protection to enforce PR reviews and CI checks!**
