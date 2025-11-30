#!/bin/bash

# Claude + GitHub Integration Setup Script
# This script helps you set up Claude AI integration with GitHub

set -e

echo "🤖 Claude + GitHub Integration Setup"
echo "======================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo -e "${RED}❌ GitHub CLI (gh) not found${NC}"
    echo "Install from: https://cli.github.com/"
    echo "Or run: brew install gh (macOS) / winget install GitHub.cli (Windows)"
    exit 1
fi

echo -e "${GREEN}✅ GitHub CLI found${NC}"
echo ""

# Check if user is authenticated
if ! gh auth status &> /dev/null; then
    echo -e "${YELLOW}⚠️  Not authenticated with GitHub${NC}"
    echo "Running: gh auth login"
    gh auth login
fi

echo -e "${GREEN}✅ GitHub authenticated${NC}"
echo ""

# Get repository info
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")

if [ -z "$REPO" ]; then
    echo -e "${RED}❌ Not in a GitHub repository${NC}"
    echo "Navigate to your repository directory and try again"
    exit 1
fi

echo -e "${BLUE}📦 Repository: $REPO${NC}"
echo ""

# Check for Anthropic API key
echo "🔑 Anthropic API Key Setup"
echo "--------------------------"
echo ""
echo "To enable AI-powered code reviews, you need an Anthropic API key."
echo ""
echo "Steps to get your key:"
echo "1. Visit: https://console.anthropic.com/"
echo "2. Sign up or log in"
echo "3. Go to 'API Keys' section"
echo "4. Click 'Create Key'"
echo "5. Copy the key (starts with 'sk-ant-')"
echo ""

read -p "Do you have an Anthropic API key? (y/n): " has_key

if [ "$has_key" != "y" ]; then
    echo ""
    echo -e "${YELLOW}⚠️  Skipping API key setup${NC}"
    echo "You can add it later by running:"
    echo "  gh secret set ANTHROPIC_API_KEY"
    echo ""
else
    echo ""
    read -sp "Paste your Anthropic API key: " api_key
    echo ""

    if [ -z "$api_key" ]; then
        echo -e "${RED}❌ No API key provided${NC}"
        exit 1
    fi

    # Validate key format
    if [[ ! "$api_key" =~ ^sk-ant- ]]; then
        echo -e "${YELLOW}⚠️  Warning: API key doesn't match expected format (sk-ant-...)${NC}"
        read -p "Continue anyway? (y/n): " continue
        if [ "$continue" != "y" ]; then
            exit 1
        fi
    fi

    # Set secret
    echo ""
    echo "Setting GitHub secret..."
    echo "$api_key" | gh secret set ANTHROPIC_API_KEY

    echo -e "${GREEN}✅ API key added to repository secrets${NC}"
fi

echo ""
echo "📋 Verifying Integration"
echo "------------------------"
echo ""

# Check workflows
if [ -f ".github/workflows/claude-pr-review.yml" ]; then
    echo -e "${GREEN}✅ PR Review workflow found${NC}"
else
    echo -e "${RED}❌ PR Review workflow missing${NC}"
fi

if [ -f ".github/workflows/claude-issue-analysis.yml" ]; then
    echo -e "${GREEN}✅ Issue Analysis workflow found${NC}"
else
    echo -e "${RED}❌ Issue Analysis workflow missing${NC}"
fi

if [ -f ".mcp.json" ]; then
    if grep -q '"github"' .mcp.json; then
        echo -e "${GREEN}✅ GitHub MCP server configured${NC}"
    else
        echo -e "${YELLOW}⚠️  GitHub MCP server not found in .mcp.json${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  .mcp.json not found${NC}"
fi

echo ""
echo "🎉 Setup Complete!"
echo "=================="
echo ""
echo "What's enabled:"
echo ""
if [ "$has_key" = "y" ]; then
    echo "✅ Automated PR Reviews - Claude will review every PR to main/develop"
    echo "✅ Issue Analysis - Add 'needs-analysis' label to get AI insights"
    echo "✅ GitHub MCP - Use Claude Code to manage issues/PRs"
else
    echo "⚠️  PR Reviews - Disabled (no API key)"
    echo "⚠️  Issue Analysis - Disabled (no API key)"
    echo "✅ GitHub MCP - Enabled (works with Claude Code)"
fi
echo ""
echo "Next Steps:"
echo ""
echo "1. Create a test PR:"
echo "   git checkout -b test-claude-review"
echo "   echo '// test' >> README.md"
echo "   git commit -am 'Test Claude review'"
echo "   git push origin test-claude-review"
echo "   gh pr create --title 'Test' --body 'Testing Claude AI review'"
echo ""
echo "2. Check for Claude's review comment in ~30 seconds"
echo ""
echo "3. Read full documentation:"
echo "   cat CLAUDE_GITHUB_INTEGRATION.md"
echo ""
echo "4. View workflow runs:"
echo "   gh run list"
echo ""
echo "Need help? https://github.com/$REPO/issues"
echo ""
