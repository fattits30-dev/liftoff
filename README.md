# 🚀 Liftoff - Agent Manager for VS Code

Sheffield's answer to Google Antigravity. Multi-agent orchestration with Claude Code integration and browser automation.

## Features

### 💬 Chat Interface
- **Tab-based UI** - Each agent gets its own tab, like browser tabs
- **Real-time chat** - Talk to agents just like chatting with Claude
- **Multi-turn conversations** - Full context preserved between messages
- **Streaming responses** - See agent output as it happens
- **Your messages highlighted** - Clear distinction between you and agent

### 🎛️ Agent Manager Surface
- Spawn, orchestrate, and observe multiple AI agents simultaneously
- Real-time streaming JSON output from Claude Code
- Visual status tracking (running, completed, error)
- Cost tracking per agent

### 🤖 Specialized Agents
| Type | Focus |
|------|-------|
| 🎨 Frontend | UI/UX, React, CSS, accessibility |
| ⚙️ Backend | APIs, databases, server logic |
| 🧪 Testing | Tests, coverage, mocking |
| 🌐 Browser | Playwright automation, screenshots |
| 🔧 General | Any development task |

### 🔄 Inter-Agent Communication
- Agents can hand off tasks to specialists automatically
- `HANDOFF:backend:` syntax triggers auto-spawn of target agent
- Broadcast messages to all agents
- Full message history tracking

### 📦 Artifact System
- Automatic extraction of code blocks from agent output
- Screenshot capture from browser agent
- Filter artifacts by type (code, screenshots, files)
- Copy code, view screenshots, open files directly

### 💾 Persistent History
- Session history saved automatically
- View past sessions with agent records and artifacts
- Survives VS Code restarts

### 🌐 Browser Automation
- Built-in Playwright integration
- Automatic responsive testing (mobile, tablet, desktop)
- Screenshot capture with artifact tracking
- Navigate, click, type, evaluate scripts

## Quick Start

```bash
cd liftoff
setup.bat          # Windows
# or
npm install && npm run compile
```

Then:
1. Open folder in VS Code
2. Press **F5** to launch
3. Click 🚀 rocket in sidebar
4. Spawn agents and watch 'em work

## Commands

- `Liftoff: Open Agent Manager` - Focus the manager panel
- `Liftoff: Spawn New Agent` - Quick spawn via command palette
- `Liftoff: Continue Agent Conversation` - Resume a completed agent
- `Liftoff: Stop All Agents` - Kill everything
- `Liftoff: View Session History` - Browse past sessions

## Claude Code Integration

Liftoff uses Claude Code's headless mode with full streaming JSON output:

```bash
claude -p "task" --output-format stream-json --append-system-prompt "..." --allowedTools "..."
```

Features used:
- `--output-format stream-json` - Real-time streaming with structured data
- `--append-system-prompt` - Agent-specific personalities
- `--allowedTools` - Restricted toolsets per agent type
- `--resume <session-id>` - Multi-turn conversation support
- Session IDs for conversation continuity

## Requirements

- VS Code 1.85+
- Node.js 18+
- Claude Code CLI installed
- Playwright (installed automatically)

## Configuration

In VS Code settings (`Ctrl+,`):

| Setting | Default | Description |
|---------|---------|-------------|
| `liftoff.claudePath` | `C:\Users\sava6\.local\bin\claude.exe` | Path to Claude Code CLI |
| `liftoff.autoHandoff` | `true` | Auto-spawn agents on handoff requests |

## Architecture

```
src/
├── extension.ts           # Entry point, command registration
├── agentManager.ts        # Agent lifecycle, Claude Code subprocess
├── agentCommunication.ts  # Inter-agent messaging, artifacts
├── managerViewProvider.ts # Manager Surface UI
├── artifactViewerProvider.ts # Artifact panel UI
├── browserAutomation.ts   # Playwright wrapper
└── persistence.ts         # Session history storage
```

## How Handoffs Work

Agents can request help from specialists using simple syntax in their output:

```
HANDOFF:frontend:Build a responsive navbar with mobile menu
HANDOFF:testing:Write unit tests for the auth module
HANDOFF:browser:Test the login flow at http://localhost:3000
```

Liftoff parses these and auto-spawns the appropriate agent.

## Built in Sheffield 🍺

No corporate bollocks. No rate limits. Your agents, your rules.

Made with Henderson's Relish and spite.
