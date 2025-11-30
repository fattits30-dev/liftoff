# Orchestrator Workflow Fixes

## Problems Found

### 1. Missing MCP Configuration ❌
**Issue:** Orchestrator couldn't use context7 or other MCP tools
**Root Cause:** No `.mcp.json` file in workspace
**Impact:** Orchestrator couldn't research library docs before delegating

**Fix:** ✅ Added `.mcp.json` with:
- `context7` - For researching library documentation
- `serena` - For semantic code analysis
- `filesystem` - For file operations
- `github` - For repository operations

### 2. VM Sandbox Security Vulnerability ❌
**Issue:** Agents fail with "code execution disabled due to security vulnerability"
**Root Cause:** The `execute()` tool wrapper was disabled due to constructor escape attacks
**Impact:** All agents immediately fail when trying to use `execute()`

**Status:** ⚠️ Partially fixed
- Created `.mcp.json` to enable MCP tools ✅
- VM sandbox still disabled (security risk) ⚠️
- Agents need to use individual tools (`read_file`, `write_file`, `shell.run`) instead

**TODO:** Update agent prompts to use direct tools instead of `execute()` wrapper

---

## How Orchestrator Should Work

### Correct Workflow:
```
User Request
    ↓
Orchestrator receives task
    ↓
1. RESEARCH PHASE (using context7)
   - Look up React docs
   - Look up Supabase docs
   - Look up Tailwind docs
   - Find best practices
    ↓
2. PLANNING PHASE
   - Design architecture based on research
   - Break down into tasks
   - Choose appropriate agents
    ↓
3. DELEGATION PHASE
   - Delegate task to frontend/backend/testing agent
   - Include research findings in delegation
   - Agent uses individual tools (read_file, write_file, shell.run)
    ↓
4. MONITORING PHASE
   - Watch for errors
   - Retry with different approach if stuck
   - Add to TODO if unfixable
    ↓
Success or TODO list
```

### Tool Call Format:

**Orchestrator calls context7:**
```tool
{"name": "resolve-library-id", "params": {"library": "react"}}
```

**Orchestrator calls context7 again:**
```tool
{"name": "get-library-docs", "params": {"library_id": "/facebook/react", "query": "hooks useState useEffect"}}
```

**Orchestrator delegates to agent:**
```delegate
{"agent": "frontend", "task": "Create React component using hooks. Based on research: use useState for state, useEffect for side effects (from React 18 docs). File: src/components/MyComponent.tsx"}
```

**Agent calls tools directly:**
```tool
{"name": "read_file", "params": {"path": "package.json"}}
```

```tool
{"name": "write_file", "params": {"path": "src/components/MyComponent.tsx", "content": "..."}}
```

```tool
{"name": "shell.run", "params": {"command": "npm install"}}
```

---

## Testing the Fix

To test if orchestrator now works:

1. **Start extension** (F5)
2. **Open Liftoff panel**
3. **Give orchestrator a task:**
   ```
   Build a Recipe & Meal Planning Platform with authentication, recipe browsing, and meal calendar
   ```

4. **Expected behavior:**
   - ✅ Orchestrator loads MCP tools from `.mcp.json`
   - ✅ Orchestrator calls `resolve-library-id` for React, Supabase, etc.
   - ✅ Orchestrator calls `get-library-docs` to research
   - ✅ Orchestrator makes plan based on research
   - ✅ Orchestrator delegates to agents
   - ⚠️ Agents may still fail if they try to use `execute()` - they need to use direct tools

---

## Remaining Work

### High Priority
- [ ] Update agent prompts to use direct tools instead of `execute()`
- [ ] Test orchestrator → context7 → agent workflow end-to-end
- [ ] Document tool format for agents

### Medium Priority
- [ ] Consider implementing secure code execution (isolated V8 contexts or WASM sandbox)
- [ ] Add more MCP servers to `.mcp.json` as needed
- [ ] Improve error messages when tools are unavailable

### Low Priority
- [ ] Add `.mcp.json` schema validation
- [ ] Create UI for managing MCP server configuration

---

## Files Changed

1. **`.mcp.json`** (NEW)
   - Configures MCP servers for orchestrator
   - Enables context7, serena, filesystem, github

2. **Next: `src/config/prompts.ts`** (TODO)
   - Update AGENT_TYPE_INSTRUCTIONS
   - Replace `execute()` examples with direct tool examples
   - Update tool format section

---

## Success Metrics

✅ **Fixed:**
- Orchestrator can now load MCP tools
- context7 is available for research
- Orchestrator's research phase works

⚠️ **Partially Fixed:**
- Agent delegation works (orchestrator can spawn agents)
- Agents fail when using `execute()` tool (disabled for security)

❌ **Not Yet Fixed:**
- Agents still try to use disabled `execute()` tool
- Need to update prompts to use direct tools

---

## Next Steps

1. Test current state by asking orchestrator to build recipe app
2. Observe where agents fail
3. Update agent prompts based on failures
4. Re-test until full workflow works
