# 🚀 Liftoff - Autonomous AI Coding Agents for VS Code

**Liftoff is an autonomous multi-agent system that actually DOES the work, not just suggests it.**

You give it a task → It plans → Spawns specialized agents → They execute → You get results.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    YOUR TASK                                │
│              "Add a login form and test it"                 │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              ORCHESTRATOR (Planning Brain)                  │
│  • Breaks task into steps                                   │
│  • Picks the right specialist for each step                 │
│  • Retries failures (max 3 attempts)                        │
│  • Tracks unresolved issues as TODOs                        │
└─────────────────────────────────────────────────────────────┘
                    │           │
          Step 1    │           │  Step 2
                    ▼           ▼
         ┌──────────────┐  ┌──────────────┐
         │ 🎨 Frontend  │  │ 🧪 Testing   │
         │    Agent     │  │    Agent     │
         └──────────────┘  └──────────────┘
                    │           │
                    ▼           ▼
              Creates form   Runs tests
              component      verifies it
```

## Specialized Agents

| Agent | Expertise |
|-------|-----------|
| 🎨 **Frontend** | React, Vue, CSS, HTML, UI components, styling |
| ⚙️ **Backend** | APIs, databases, Python, Node.js, business logic |
| 🧪 **Testing** | Run tests, fix failures, write new tests |
| 🌐 **Browser** | Playwright automation, UI testing, screenshots |
| 🧹 **Cleaner** | Dead code removal, linting, formatting |
| 🔧 **General** | File operations, git, misc tasks |

Each agent has its own LLM loop with a specialized system prompt and full tool access.


## Retry & TODO System

Liftoff doesn't give up easily:

1. **Task fails** → Orchestrator analyzes error
2. **Retry 1** → Maybe different approach
3. **Retry 2** → Try harder
4. **Retry 3** → Last chance
5. **Still failing?** → Added to TODO list, continue with other work

At the end you get a summary + any TODOs that need manual attention.

## Quick Start

```bash
# Clone and build
cd liftoff
npm install
npm run compile

# Run in VS Code
# Press F5 to launch Extension Development Host
```

Then:
1. Set your HuggingFace API key: `Ctrl+Shift+P` → "Liftoff: Set HuggingFace API Key"
2. Click the 🚀 rocket in the sidebar
3. Open Orchestrator Chat and describe what you want built
4. Watch agents spawn and work autonomously

## Commands

| Command | Description |
|---------|-------------|
| `Liftoff: Open Agent Manager` | View all agents and their status |
| `Liftoff: Open Orchestrator Chat` | Talk to the planning brain |
| `Liftoff: Spawn New Agent` | Manually spawn a specific agent type |
| `Liftoff: Set HuggingFace API Key` | Configure cloud inference |
| `Liftoff: Stop All Agents` | Emergency stop |
| `Liftoff: View Session History` | See past sessions |
| `Liftoff: Initialize MCP Config` | Set up MCP servers |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `liftoff.huggingfaceApiKey` | - | Your HuggingFace API key (required) |
| `liftoff.defaultModel` | `deepseek-ai/DeepSeek-V3-0324` | Default LLM for agents |
| `liftoff.autoHandoff` | `true` | Auto-spawn agents when orchestrator delegates |
| `liftoff.showAgentButtons` | `true` | Show quick-spawn buttons in UI |


## Available Models (HuggingFace)

| Model | Best For |
|-------|----------|
| `deepseek-ai/DeepSeek-V3-0324` | General coding (default, recommended) |
| `deepseek-ai/DeepSeek-R1` | Complex reasoning tasks |
| `Qwen/Qwen2.5-Coder-32B-Instruct` | Code generation |
| `Qwen/Qwen3-Coder-30B-A3B-Instruct` | Fast coding |
| `meta-llama/Llama-3.3-70B-Instruct` | General purpose |

## Architecture

```
src/
├── extension.ts           # VS Code entry point, command registration
├── mainOrchestrator.ts    # 🧠 Planning brain - delegates to agents
├── autonomousAgent.ts     # Agent manager - spawns/runs specialized agents
├── hfProvider.ts          # HuggingFace API streaming client
├── config/
│   └── models.ts          # Model definitions and defaults
├── tools/                 # Agent tooling (file ops, git, browser)
├── mcp/                   # MCP server integration
├── memory/                # Semantic memory and lessons system
└── webview/               # UI components
```

## How Agents Execute

Each agent runs in a loop:
1. **Think** - LLM decides what tool to call
2. **Execute** - Tool runs (file write, terminal command, browser action)
3. **Observe** - Result fed back to LLM
4. **Repeat** until task complete or max iterations

Agents have access to:
- File system (read, write, search)
- Terminal (run commands, see output)
- Git (commit, branch, diff)
- Browser (Playwright - navigate, click, screenshot)
- Lessons DB (remember what worked before)

## Requirements

- VS Code 1.85+
- Node.js 18+
- HuggingFace API key (free tier works)
- [uv](https://docs.astral.sh/uv/) (for Serena semantic tools)

## Serena Integration (IDE-like Code Intelligence)

Liftoff integrates [Serena](https://github.com/oraios/serena) for semantic code understanding. Instead of agents reading whole files, they can:

| Tool | What It Does |
|------|--------------|
| `find_symbol` | Find functions/classes by name |
| `find_referencing_symbols` | Find all usages of a symbol |
| `get_symbol_documentation` | Get docstrings without reading files |
| `insert_after_symbol` | Add code after a function |
| `replace_symbol_body` | Edit just a function body |
| `search_for_pattern` | Regex search across project |

**Benefits:**
- 🚀 70% token savings (no reading whole files)
- 🎯 Precise edits (symbol-level, not string replace)
- 🧠 Understands code structure via LSP

Serena is auto-configured in `.mcp.json` - just make sure `uv` is installed.

## License

MIT
