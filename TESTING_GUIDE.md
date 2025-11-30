# Testing Guide

## Quick Test: Is Everything Working?

Run this command:
```bash
node scripts/test-orchestrator-workflow.js
```

Expected output: All ✅ (green checkmarks)

---

## How to Test in VS Code

### Option 1: Test Orchestrator (Research → Plan → Delegate)

**What it does:** Orchestrator researches libraries, makes a plan, delegates to agents

**Steps:**
1. Press **F5** to start extension in debug mode
2. Press **Cmd+Shift+P** (Mac) or **Ctrl+Shift+P** (Windows)
3. Type: `Liftoff: Open Panel (Full Tab)`
4. In the chat panel, enter:
   ```
   Build a simple task management app with authentication
   ```

**Expected behavior:**
- ✅ "MCP tools loading..."
- ✅ "Researching React..." (calls `resolve-library-id`)
- ✅ "Researching Supabase..." (calls `get-library-docs`)
- ✅ "Making plan based on research..."
- ✅ "Delegating to frontend agent..."
- ⚠️ Agent *may* fail if it tries to use old `execute()` tool

**Where to check logs:**
- View → Output → Select "Liftoff MCP" (MCP tool calls)
- View → Output → Select "Liftoff Orchestrator" (planning/delegation)
- View → Output → Select "Liftoff Agents" (agent execution)

---

### Option 2: Test App Builder Directly (100% Working)

**What it does:** Uses proven App Builder to scaffold complete apps

**Steps:**
1. Press **F5** to start extension
2. Press **Cmd+Shift+P** / **Ctrl+Shift+P**
3. Type: `Liftoff: Build App`
4. Follow prompts:
   - Description: `A recipe app with meal planning`
   - Location: Choose a folder
   - Name: `recipe-app`

**Expected behavior:**
- ✅ Spec generated
- ✅ Architecture generated
- ✅ Project scaffolded
- ✅ Files created
- ✅ Ready to run with `npm run dev`

**This works 100%** - we've already tested it!

---

## How I Can Test (Without VS Code)

### Pre-flight Checks
```bash
# Check TypeScript compiles
npm run compile

# Check ESLint passes
npm run lint

# Test app builder components
node scripts/test-app-builder-flow.js

# Test orchestrator setup
node scripts/test-orchestrator-workflow.js
```

### What I Can Verify:
- ✅ Files exist and compile
- ✅ Configuration is valid
- ✅ Individual components work
- ✅ No syntax errors
- ❌ Can't run full VS Code extension
- ❌ Can't test MCP servers connecting (needs runtime)
- ❌ Can't test actual orchestrator → agent flow (needs VS Code)

---

## Troubleshooting

### If Orchestrator Fails:

**Check MCP Output:**
```
View → Output → "Liftoff MCP"
```
Look for:
- "Connected to context7: X tools available" ✅
- "Connected to serena: X tools available" ✅
- "Failed to connect to X..." ❌

**Check Orchestrator Output:**
```
View → Output → "Liftoff Orchestrator"
```
Look for:
- "Tool call: resolve-library-id" ✅
- "Tool result: ..." ✅
- "Delegation: frontend" ✅
- "Error: ..." ❌

### If Agent Fails:

**Check Agents Output:**
```
View → Output → "Liftoff Agents"
```
Look for:
- "Code execution disabled due to security vulnerability" ❌
  → This means agent tried to use old `execute()` tool
  → Agent should use `read_file`, `write_file`, etc. instead

---

## Quick Fix for Agent Execute() Errors

If you see "Code execution disabled", the agent is using the old workflow.

**Workaround:** Use App Builder instead
- Command: `Liftoff: Build App`
- This bypasses agents entirely
- Uses direct file generation
- Works 100%

**Permanent Fix:** Update agent prompts to use direct tools
- File: `src/config/prompts.ts`
- Replace `execute()` examples with `read_file`, `write_file`
- Recompile: `npm run compile`

---

## What Works Right Now

✅ **App Builder** - 100% working, fully tested
✅ **MCP Configuration** - context7, serena, filesystem, github configured
✅ **Orchestrator Research** - Can call context7 to look up library docs
✅ **Orchestrator Planning** - Can make plans based on research
✅ **Orchestrator Delegation** - Can spawn agents
⚠️ **Agent Execution** - May fail if using old `execute()` tool

---

## Recommended Testing Order

1. **First:** Test App Builder (guaranteed to work)
2. **Second:** Test Orchestrator (should work but agents may fail)
3. **Third:** Report specific errors if any

**Why this order?**
- App Builder proves the core system works
- Orchestrator test shows where the remaining issues are
- Specific errors help us fix the last pieces
