# 🤖 Claude + GitHub Integration Guide

This guide explains how Claude AI is integrated with your GitHub repository to supercharge development.

---

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Features Overview](#features-overview)
3. [Setup Instructions](#setup-instructions)
4. [Usage Guide](#usage-guide)
5. [How It Works](#how-it-works)
6. [Troubleshooting](#troubleshooting)
7. [Advanced Configuration](#advanced-configuration)

---

## 🚀 Quick Start

### 1. Enable AI Code Reviews

```bash
# 1. Get Anthropic API key
Visit: https://console.anthropic.com/
Sign up and create an API key

# 2. Add to GitHub Secrets
Go to: https://github.com/fattits30-dev/liftoff/settings/secrets/actions
Click "New repository secret"
Name: ANTHROPIC_API_KEY
Value: [paste your API key]

# 3. Done!
Create a PR and Claude will automatically review it
```

### 2. Use GitHub MCP with Claude Code

```bash
# Already configured in .mcp.json!
# Claude Code can now:
- Create/read/update GitHub issues
- Review pull requests
- Manage branches and commits
- Search repositories
- Analyze code changes
```

---

## ✨ Features Overview

### 🔍 Automated PR Reviews

**Trigger:** Every pull request to `main` or `develop`

**What Claude Does:**
- Analyzes code changes line-by-line
- Identifies bugs, security issues, performance problems
- Suggests improvements and best practices
- Provides specific, actionable feedback
- Checks TypeScript patterns and VS Code extension guidelines

**Example Review:**
```markdown
## 🤖 Claude AI Code Review

### 🐛 Code Quality Issues
1. Line 45: Potential null pointer exception - add optional chaining
2. Line 89: Memory leak - missing cleanup in useEffect

### 🔒 Security Concerns
- Line 112: User input not sanitized before shell execution
- Recommendation: Use allowlist validation

### ⚡ Performance Issues
- Line 156: Expensive operation in render loop
- Suggestion: Move to useCallback or useMemo

### ✅ Best Practices
- Great use of TypeScript strict mode
- Well-structured error handling

### 🧪 Testing Gaps
- Missing edge case: empty string input
- Consider adding test for concurrent executions
```

### 🎯 Issue Analysis

**Trigger:** Issues labeled with `needs-analysis`, `bug`, or `enhancement`

**What Claude Does:**
- Analyzes issue description and context
- **For Bugs:**
  - Root cause analysis
  - Reproduction steps
  - Suggested fix with file locations
  - Testing guidance
- **For Features:**
  - Design approach
  - Architecture impact
  - Edge cases to consider
  - Testing strategy

### 🛠️ Claude Code Integration (MCP)

**Always Available** when using Claude Code CLI or API

**Capabilities:**
```typescript
// Claude can execute these GitHub operations:

// Issues
- create_issue
- list_issues
- get_issue
- update_issue
- add_issue_comment
- search_issues

// Pull Requests
- create_pull_request
- list_pull_requests
- get_pull_request
- merge_pull_request
- create_or_update_file
- push_files

// Repositories
- create_repository
- search_repositories
- get_file_contents
- fork_repository

// Branches & Commits
- create_branch
- list_branches
- list_commits
- get_commit

// Code Search
- search_code (searches across ALL GitHub)
```

---

## 🔧 Setup Instructions

### Method 1: Automated (Recommended)

```bash
# 1. Get API Key
https://console.anthropic.com/ → API Keys → Create Key

# 2. Add to GitHub
Repository Settings → Secrets and variables → Actions
New secret: ANTHROPIC_API_KEY = [your key]

# 3. Test
Create a test PR and check for AI review comment
```

### Method 2: Manual Configuration

If you want to customize the workflows:

1. **Edit PR Review Workflow**
   - File: `.github/workflows/claude-pr-review.yml`
   - Customize prompt, model, or review criteria

2. **Edit Issue Analysis Workflow**
   - File: `.github/workflows/claude-issue-analysis.yml`
   - Add custom analysis patterns

3. **Configure GitHub MCP**
   - File: `.mcp.json`
   - Already configured! GitHub MCP server enabled

---

## 📖 Usage Guide

### Using AI PR Reviews

```bash
# 1. Create a branch and make changes
git checkout -b feature/my-feature
# ... make code changes ...
git commit -m "Add feature"
git push origin feature/my-feature

# 2. Create Pull Request on GitHub
# Visit: https://github.com/fattits30-dev/liftoff/compare

# 3. Wait for Claude Review (~30 seconds)
# Claude will post a review comment automatically

# 4. Address feedback
# - Fix critical issues (bugs, security)
# - Consider performance suggestions
# - Update tests as recommended

# 5. Push updates
git add .
git commit -m "Address Claude review feedback"
git push

# Claude will re-review the changes!
```

### Using Issue Analysis

```bash
# 1. Create an issue on GitHub
# Visit: https://github.com/fattits30-dev/liftoff/issues/new

# 2. Add label 'needs-analysis' or 'bug' or 'enhancement'

# 3. Wait for Claude Analysis (~20 seconds)
# Claude will post analysis comment with:
# - Root cause (for bugs)
# - Design approach (for features)
# - Specific file locations
# - Testing recommendations

# 4. Use analysis to implement
# Reference Claude's suggestions when coding
```

### Using Claude Code with GitHub

```bash
# In Claude Code session:

# Create issue
"Create a GitHub issue titled 'Add dark mode' with description..."

# Review PR
"Get pull request #123 and summarize the changes"

# Search code
"Search GitHub for React hooks implementations"

# Create PR
"Create a pull request from my current branch with title..."

# List issues
"Show me all open bugs in the repository"

# Analyze commits
"Get the last 5 commits and explain what changed"
```

---

## 🔍 How It Works

### Architecture

```
┌─────────────────┐
│   GitHub Event  │  (PR opened, issue created)
│  (webhook)      │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ GitHub Actions  │  (Workflow triggered)
│  Runner         │
└────────┬────────┘
         │
         ├─> Checkout code
         ├─> Get diff/issue content
         ├─> Call Claude API
         │   └─> Send context + prompt
         │   └─> Receive analysis
         ├─> Post comment
         └─> Update labels (optional)
```

### Security

**API Keys:**
- Stored in GitHub Secrets (encrypted at rest)
- Never exposed in logs or code
- Only accessible to GitHub Actions runners

**Data Privacy:**
- Code diffs sent to Anthropic API
- No persistent storage by Anthropic
- Covered by Anthropic's privacy policy

**Permissions:**
- Workflows use minimal permissions
- `pull-requests: write` for PR comments
- `issues: write` for issue comments
- `contents: read` for code access

### Cost Estimate

**Anthropic API Pricing:**
- Claude Sonnet 4: $3 per million input tokens, $15 per million output tokens
- Average PR review: ~10K input tokens + 2K output tokens
- Cost per review: ~$0.06 (6 cents)

**Monthly Estimate:**
- 20 PRs/month = $1.20/month
- 50 PRs/month = $3.00/month
- 100 PRs/month = $6.00/month

**Free Tier:**
- Anthropic offers free credits for new accounts
- Check console.anthropic.com for current offers

---

## 🐛 Troubleshooting

### Issue: AI Review Not Posting

**Check:**
1. API key is set in repository secrets
2. Secret name is exactly `ANTHROPIC_API_KEY`
3. Workflow has permission to comment (check `permissions:` in yml)
4. PR targets `main` or `develop` branch

**View Logs:**
```bash
# Go to GitHub Actions tab
https://github.com/fattits30-dev/liftoff/actions

# Click latest workflow run
# Expand "Analyze with Claude" step
# Check for API errors
```

### Issue: Review Incomplete or Truncated

**Cause:** PR diff too large (>50KB)

**Solutions:**
1. Break PR into smaller changes
2. Increase truncation limit in `.github/workflows/claude-pr-review.yml`
3. Use Claude Code for manual review of large PRs

### Issue: Rate Limit Errors

**Cause:** Too many API calls

**Solutions:**
1. Check Anthropic console for usage limits
2. Upgrade API plan if needed
3. Add delay between retries in workflow

### Issue: MCP GitHub Server Not Working

**Check:**
1. GitHub token configured in Claude Code settings
2. Token has required permissions (repo, read:user)
3. MCP server enabled in `.mcp.json`

**Fix:**
```bash
# Regenerate GitHub token
https://github.com/settings/tokens

# Required scopes:
- repo (full)
- read:user
- read:org (optional)

# Update in Claude Code settings
```

---

## 🎨 Advanced Configuration

### Customize Review Criteria

Edit `.github/workflows/claude-pr-review.yml`:

```javascript
const prompt = `Review this code focusing on:
1. TypeScript type safety
2. VS Code extension best practices
3. Async/await error handling
4. Memory leak prevention
5. [YOUR CUSTOM CRITERIA]
...`;
```

### Add Custom Labels

Automatically label PRs based on review:

```yaml
- name: Auto-label PR
  uses: actions/github-script@v7
  script: |
    const hasSecurityIssues = review.includes('Security');
    if (hasSecurityIssues) {
      await github.rest.issues.addLabels({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        labels: ['security']
      });
    }
```

### Request Re-review

Trigger manual re-review by commenting on PR:

```
/claude review
```

(Requires additional workflow configuration)

### Integration with Other Tools

**Combine with:**
- Codecov (coverage + AI review)
- SonarQube (static analysis + AI insights)
- Dependabot (dependency updates + AI security review)

---

## 📊 Metrics & Insights

### Track Review Impact

```bash
# View all Claude reviews
gh pr list --json number,title,comments \
  --jq '.[] | select(.comments[].body | contains("Claude AI"))'

# Count reviewed PRs
gh pr list --state closed --json number,comments \
  --jq '[.[] | select(.comments[].body | contains("Claude AI"))] | length'
```

### Monitor API Usage

```bash
# Check Anthropic dashboard
https://console.anthropic.com/settings/usage
```

---

## 🚀 Future Enhancements

**Planned Features:**

- [ ] `/claude` slash commands in PR comments
- [ ] Automatic fix suggestions as PR review comments
- [ ] Integration with GitHub Copilot
- [ ] Custom review rulesets per file type
- [ ] Learning from accepted/rejected suggestions
- [ ] Team-specific review styles

---

## 📚 Resources

**Official Documentation:**
- [Anthropic API Docs](https://docs.anthropic.com/)
- [GitHub Actions](https://docs.github.com/en/actions)
- [MCP Specification](https://modelcontextprotocol.io/)

**Related Files:**
- `.github/workflows/claude-pr-review.yml` - PR review workflow
- `.github/workflows/claude-issue-analysis.yml` - Issue analysis workflow
- `.mcp.json` - MCP server configuration
- `TESTING.md` - Testing guide

**Support:**
- GitHub Issues: https://github.com/fattits30-dev/liftoff/issues
- Anthropic Support: support@anthropic.com

---

## 🎉 Summary

You now have Claude AI integrated with GitHub in three powerful ways:

1. **🔍 Automated PR Reviews** - Every PR gets expert AI feedback
2. **🎯 Issue Analysis** - Bugs and features analyzed automatically
3. **🛠️ Claude Code MCP** - Direct GitHub operations from Claude

**Next Steps:**
1. Add `ANTHROPIC_API_KEY` to repository secrets
2. Create a test PR to see AI review in action
3. Label an issue with `needs-analysis` to see analysis
4. Use Claude Code to manage issues and PRs

Happy coding with AI assistance! 🚀
