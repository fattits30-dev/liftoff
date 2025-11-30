# Claude + GitHub Integration Setup Script (PowerShell)
# This script helps you set up Claude AI integration with GitHub

$ErrorActionPreference = "Stop"

Write-Host "🤖 Claude + GitHub Integration Setup" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Check if gh CLI is installed
try {
    $null = Get-Command gh -ErrorAction Stop
    Write-Host "✅ GitHub CLI found" -ForegroundColor Green
} catch {
    Write-Host "❌ GitHub CLI (gh) not found" -ForegroundColor Red
    Write-Host "Install from: https://cli.github.com/" -ForegroundColor Yellow
    Write-Host "Or run: winget install GitHub.cli" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Check if user is authenticated
try {
    gh auth status 2>&1 | Out-Null
    Write-Host "✅ GitHub authenticated" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Not authenticated with GitHub" -ForegroundColor Yellow
    Write-Host "Running: gh auth login" -ForegroundColor Yellow
    gh auth login
}

Write-Host ""

# Get repository info
try {
    $repo = gh repo view --json nameWithOwner -q .nameWithOwner 2>$null
    if (-not $repo) {
        throw "Not in repository"
    }
    Write-Host "📦 Repository: $repo" -ForegroundColor Blue
} catch {
    Write-Host "❌ Not in a GitHub repository" -ForegroundColor Red
    Write-Host "Navigate to your repository directory and try again" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Check for Anthropic API key
Write-Host "🔑 Anthropic API Key Setup" -ForegroundColor Cyan
Write-Host "--------------------------" -ForegroundColor Cyan
Write-Host ""
Write-Host "To enable AI-powered code reviews, you need an Anthropic API key."
Write-Host ""
Write-Host "Steps to get your key:"
Write-Host "1. Visit: https://console.anthropic.com/"
Write-Host "2. Sign up or log in"
Write-Host "3. Go to 'API Keys' section"
Write-Host "4. Click 'Create Key'"
Write-Host "5. Copy the key (starts with 'sk-ant-')"
Write-Host ""

$hasKey = Read-Host "Do you have an Anthropic API key? (y/n)"

if ($hasKey -ne "y") {
    Write-Host ""
    Write-Host "⚠️  Skipping API key setup" -ForegroundColor Yellow
    Write-Host "You can add it later by running:"
    Write-Host "  gh secret set ANTHROPIC_API_KEY"
    Write-Host ""
} else {
    Write-Host ""
    $apiKey = Read-Host "Paste your Anthropic API key" -AsSecureString
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($apiKey)
    )

    if (-not $plainKey) {
        Write-Host "❌ No API key provided" -ForegroundColor Red
        exit 1
    }

    # Validate key format
    if ($plainKey -notmatch "^sk-ant-") {
        Write-Host "⚠️  Warning: API key doesn't match expected format (sk-ant-...)" -ForegroundColor Yellow
        $continue = Read-Host "Continue anyway? (y/n)"
        if ($continue -ne "y") {
            exit 1
        }
    }

    # Set secret
    Write-Host ""
    Write-Host "Setting GitHub secret..."
    $plainKey | gh secret set ANTHROPIC_API_KEY

    Write-Host "✅ API key added to repository secrets" -ForegroundColor Green
}

Write-Host ""
Write-Host "📋 Verifying Integration" -ForegroundColor Cyan
Write-Host "------------------------" -ForegroundColor Cyan
Write-Host ""

# Check workflows
if (Test-Path ".github\workflows\claude-pr-review.yml") {
    Write-Host "✅ PR Review workflow found" -ForegroundColor Green
} else {
    Write-Host "❌ PR Review workflow missing" -ForegroundColor Red
}

if (Test-Path ".github\workflows\claude-issue-analysis.yml") {
    Write-Host "✅ Issue Analysis workflow found" -ForegroundColor Green
} else {
    Write-Host "❌ Issue Analysis workflow missing" -ForegroundColor Red
}

if (Test-Path ".mcp.json") {
    $mcpContent = Get-Content ".mcp.json" -Raw
    if ($mcpContent -match '"github"') {
        Write-Host "✅ GitHub MCP server configured" -ForegroundColor Green
    } else {
        Write-Host "⚠️  GitHub MCP server not found in .mcp.json" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠️  .mcp.json not found" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🎉 Setup Complete!" -ForegroundColor Green
Write-Host "=================="  -ForegroundColor Green
Write-Host ""
Write-Host "What's enabled:"
Write-Host ""

if ($hasKey -eq "y") {
    Write-Host "✅ Automated PR Reviews - Claude will review every PR to main/develop" -ForegroundColor Green
    Write-Host "✅ Issue Analysis - Add 'needs-analysis' label to get AI insights" -ForegroundColor Green
    Write-Host "✅ GitHub MCP - Use Claude Code to manage issues/PRs" -ForegroundColor Green
} else {
    Write-Host "⚠️  PR Reviews - Disabled (no API key)" -ForegroundColor Yellow
    Write-Host "⚠️  Issue Analysis - Disabled (no API key)" -ForegroundColor Yellow
    Write-Host "✅ GitHub MCP - Enabled (works with Claude Code)" -ForegroundColor Green
}

Write-Host ""
Write-Host "Next Steps:"
Write-Host ""
Write-Host "1. Create a test PR:"
Write-Host "   git checkout -b test-claude-review"
Write-Host "   echo '// test' >> README.md"
Write-Host "   git commit -am 'Test Claude review'"
Write-Host "   git push origin test-claude-review"
Write-Host "   gh pr create --title 'Test' --body 'Testing Claude AI review'"
Write-Host ""
Write-Host "2. Check for Claude's review comment in ~30 seconds"
Write-Host ""
Write-Host "3. Read full documentation:"
Write-Host "   Get-Content CLAUDE_GITHUB_INTEGRATION.md"
Write-Host ""
Write-Host "4. View workflow runs:"
Write-Host "   gh run list"
Write-Host ""
Write-Host "Need help? https://github.com/$repo/issues"
Write-Host ""
