# Agent Display Issue Investigation

## User Report
"It's launching 5 agents but I've only seen 3"

## Analysis

### Agent Limit Configuration
From `src/mainOrchestrator.ts:310`:
```typescript
private readonly MAX_CONCURRENT_AGENTS = 6;
```

The system supports up to 6 concurrent agents.

### Agent Types Available
From `src/types/agentTypes.ts:11`:
```typescript
export type AgentType = 'frontend' | 'backend' | 'testing' | 'browser' | 'general' | 'cleaner';
```

Total: 6 agent types available.

### UI Rendering
From `src/webview/app.js:494`:
```javascript
agents.forEach(agent => {
    // Renders ALL agents in the array without filtering
    const statusIcon = agent.status === 'running' ? '🔄' : agent.status === 'completed' ? '✅' : '❌';
    // ... renders each agent
});
```

No filtering or slicing is applied to the agents array before rendering.

### Data Flow
1. **Agent Manager** (`src/autonomousAgent.ts:669`):
   ```typescript
   public getAllAgents(): Agent[] {
       return Array.from(this.agents.values());
   }
   ```
   Returns ALL agents without filtering.

2. **Manager View Provider** (`src/managerViewProvider.ts:76-79`):
   ```typescript
   const agents = this.agentManager.getAllAgents().map((a: IAgent) => ({
       id: a.id, name: a.name, status: a.status, task: a.task,
       iterations: a.iterations, type: a.type
   }));
   this._view.webview.postMessage({ type: 'agents', agents });
   ```
   Sends ALL agents to webview.

3. **Webview** (`src/webview/app.js:700-702`):
   ```javascript
   case 'agents':
       agents = msg.agents || [];
       renderAgents();
   ```
   Receives agents and renders them all.

## Possible Causes

### 1. Agent State Mismatch
Agents might be spawned but not yet added to the `agents` Map:
- Spawning happens asynchronously
- UI update might fire before agent is fully registered

### 2. Status Filtering
Agents with certain statuses might not render correctly:
```javascript
const statusIcon = agent.status === 'running' ? '🔄' :
                   agent.status === 'completed' ? '✅' : '❌';
```

If an agent has status other than 'running', 'completed', or 'error', it still renders but might be visually unclear.

### 3. UI Timing Issue
The `updateView()` might be called before all agents are spawned:
```typescript
// Line 43 in managerViewProvider.ts
await this.agentManager.spawnAgent({ type: msg.type, task });
this.updateView(); // Might fire too early?
```

### 4. Event-Driven Updates Missing
From `managerViewProvider.ts:16-20`:
```typescript
this._disposables.push(
    agentManager.on('agentSpawned', () => this.updateView()),
    agentManager.on('statusChange', () => this.updateView()),
    agentManager.on('output', (data: AgentOutputEvent) => this.sendOutput(data))
);
```

If `agentSpawned` event isn't fired for all agents, some might not trigger UI updates.

## Debugging Steps

1. **Add Console Logging**
   ```typescript
   // In updateView()
   console.log('Updating view with agents:', agents.length);
   agents.forEach(a => console.log(`  - ${a.name} (${a.status})`));
   ```

2. **Check Agent Registration**
   ```typescript
   // In spawnAgent()
   console.log('Agent spawned:', agent.id, agent.name);
   this.agents.set(agent.id, agent);
   console.log('Total agents:', this.agents.size);
   ```

3. **Verify Event Firing**
   ```typescript
   // After agent creation
   this.emit('agentSpawned', agent);
   console.log('agentSpawned event fired for:', agent.id);
   ```

## Recommendations

### Quick Fix: Force UI Update
In `managerViewProvider.ts`, add a small delay before updating:
```typescript
await this.agentManager.spawnAgent({ type: msg.type, task });
setTimeout(() => this.updateView(), 100); // Give agent time to register
```

### Better Fix: Ensure Event-Driven Updates
Make sure `agentSpawned` event fires AFTER agent is added to Map:
```typescript
// In spawnAgent()
this.agents.set(agent.id, agent);
this.emit('agentSpawned', agent); // Fire after Map update
```

### Best Fix: Add Agent Counter to UI
Show total agents vs visible:
```javascript
html += `<div style="color: var(--text-muted);">
    Showing ${agents.length} of ${totalSpawned} agents
</div>`;
```

## Next Steps

1. Add logging to see actual agent count
2. Check if `agentSpawned` event fires for all 5 agents
3. Verify agents array length in webview
4. Check if any agents have unexpected status values
