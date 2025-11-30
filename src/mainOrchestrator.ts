/**
 * MainOrchestrator - The BRAIN that plans and delegates to specialized agents
 * 
 * Architecture:
 * ┌──────────────────────────────────┐
 * │      MainOrchestrator            │
 * │   (Planner - decides WHO works)  │
 * └──────────────────────────────────┘
 *          │ DELEGATE:frontend:task
 *          ▼
 * ┌──────────────────────────────────┐
 * │  🎨 Frontend Agent (own LLM)     │
 * │  Specialized system prompt       │
 * │  Executes until done/failed      │
 * └──────────────────────────────────┘
 *          │ Result
 *          ▼
 * ┌──────────────────────────────────┐
 * │      MainOrchestrator            │
 * │  Success? → Next step            │
 * │  Failed?  → Retry (max 3)        │
 * │  3 fails? → Mark TODO, continue  │
 * └──────────────────────────────────┘
 */

import * as vscode from 'vscode';
import { HuggingFaceProvider } from './hfProvider';
import { AutonomousAgentManager, Agent } from './autonomousAgent';
import { SemanticMemoryStore, OrchestratorMemory } from './memory/agentMemory';
import { DEFAULT_CLOUD_MODEL_NAME, LIMITS } from './config';
import { AgentType } from './types/agentTypes';

export interface TodoItem {
    task: string;
    agentType: AgentType;
    error: string;
    attempts: number;
    timestamp: Date;
}

interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

type OrchestratorStatus = 'idle' | 'planning' | 'delegating' | 'waiting' | 'completed' | 'error';

const MAX_RETRIES = 3;

const PLANNER_SYSTEM_PROMPT = `You are the Liftoff Orchestrator - a planning brain that delegates work to specialized agents.

## YOUR ROLE
You PLAN and DELEGATE. You do NOT execute code yourself.
You analyze tasks and assign them to the right specialist agent.

## AVAILABLE AGENTS
- **frontend** 🎨 - React, Vue, CSS, HTML, UI components, styling
- **backend** ⚙️ - APIs, databases, Python, Node.js servers, business logic  
- **testing** 🧪 - Run tests, fix test failures, write new tests
- **browser** 🌐 - Playwright automation, UI testing, screenshots
- **cleaner** 🧹 - Remove dead code, fix linting, format files
- **general** 🔧 - File operations, git, misc tasks that don't fit above

## HOW TO DELEGATE
Output this EXACT format to assign work:
\`\`\`delegate
{"agent": "frontend", "task": "Fix the button styling in src/components/Button.tsx"}
\`\`\`

## WORKFLOW
1. User gives you a task
2. You break it down into steps
3. For each step, DELEGATE to the right agent
4. Wait for result (I'll tell you success/failure)
5. If failed: analyze error, maybe retry with different approach
6. If succeeded: move to next step
7. When ALL done: output \`\`\`complete\`\`\` with summary

## RULES
- ONE delegation at a time - wait for result before next
- Be SPECIFIC in task descriptions - agents work better with clear instructions
- If an agent fails 3 times on same task, I'll mark it as TODO and you continue
- DON'T delegate tiny tasks - combine related work into meaningful chunks
- Frontend + styling = frontend agent (not separate agents)
- Running tests + fixing failures = testing agent handles both

## EXAMPLE INTERACTION
User: "Add a login form and make sure it works"

You: I'll break this down:
1. Create the login form component (frontend)
2. Add form validation (frontend) 
3. Test the form works (testing)

Starting with step 1:
\`\`\`delegate
{"agent": "frontend", "task": "Create a login form component at src/components/LoginForm.tsx with email and password fields, submit button, and basic validation"}
\`\`\`

[After success, you continue to next step or adjust based on result]
`;


/**
 * MainOrchestrator - Plans and delegates to specialized agents
 */
export class MainOrchestrator {
    private hfProvider: HuggingFaceProvider | null = null;
    private agentManager: AutonomousAgentManager | null = null;
    private messages: Message[] = [];
    private outputChannel: vscode.OutputChannel;
    private status: OrchestratorStatus = 'idle';
    private abortController: AbortController | null = null;
    private iterations: number = 0;
    private workspaceRoot: string;

    // Retry tracking: task -> attempt count
    private retryTracker: Map<string, number> = new Map();
    
    // TODO list for tasks that failed after max retries
    private todoList: TodoItem[] = [];

    // Memory systems
    private semanticMemory: SemanticMemoryStore | null = null;
    private orchestratorMemory: OrchestratorMemory | null = null;

    // Streaming buffer for batching thought emissions
    private streamBuffer: string = '';
    private streamFlushTimer: NodeJS.Timeout | null = null;
    private readonly STREAM_FLUSH_MS = 50; // Flush every 50ms for smooth display

    private config = {
        cloudModel: DEFAULT_CLOUD_MODEL_NAME,
        maxIterations: LIMITS.orchestratorMaxIterations,
    };

    // Events for UI
    private readonly _onMessage = new vscode.EventEmitter<Message>();
    public readonly onMessage = this._onMessage.event;

    private readonly _onStatusChange = new vscode.EventEmitter<OrchestratorStatus>();
    public readonly onStatusChange = this._onStatusChange.event;

    private readonly _onAgentSpawned = new vscode.EventEmitter<{ agent: Agent; task: string }>();
    public readonly onAgentSpawned = this._onAgentSpawned.event;

    private readonly _onAgentCompleted = new vscode.EventEmitter<{ agent: Agent; success: boolean; error?: string }>();
    public readonly onAgentCompleted = this._onAgentCompleted.event;

    private readonly _onTodoAdded = new vscode.EventEmitter<TodoItem>();
    public readonly onTodoAdded = this._onTodoAdded.event;

    private readonly _onThought = new vscode.EventEmitter<string>();
    public readonly onThought = this._onThought.event;

    constructor(
        workspaceRoot: string,
        semanticMemory?: SemanticMemoryStore,
        orchestratorMemory?: OrchestratorMemory
    ) {
        this.workspaceRoot = workspaceRoot;
        this.outputChannel = vscode.window.createOutputChannel('Liftoff Orchestrator');
        this.semanticMemory = semanticMemory || null;
        this.orchestratorMemory = orchestratorMemory || null;

        // Initialize with planner system prompt
        this.messages.push({
            role: 'system',
            content: PLANNER_SYSTEM_PROMPT,
            timestamp: new Date()
        });

        this.log('Orchestrator initialized');
    }

    /**
     * Connect to the agent manager (call this after construction)
     */
    setAgentManager(manager: AutonomousAgentManager): void {
        this.agentManager = manager;
        this.log('Agent manager connected');
    }

    setApiKey(apiKey: string): void {
        this.hfProvider = new HuggingFaceProvider(apiKey);
        this.log('API key configured');
    }


    /**
     * Main entry point - process user task
     */
    async chat(userMessage: string): Promise<string> {
        if (!this.hfProvider) {
            return "❌ Please set your API key first.";
        }
        if (!this.agentManager) {
            return "❌ Agent manager not connected.";
        }

        this.addMessage('user', userMessage);
        this.abortController = new AbortController();
        this.iterations = 0;
        this.retryTracker.clear();

        try {
            return await this.planningLoop();
        } catch (err: any) {
            this.setStatus('error');
            return `❌ Error: ${err.message}`;
        }
    }

    /**
     * Main planning loop - delegates to agents and handles results
     */
    private async planningLoop(): Promise<string> {
        while (this.iterations < this.config.maxIterations) {
            if (this.abortController?.signal.aborted) {
                return '🛑 Aborted by user.';
            }

            this.iterations++;
            this.setStatus('planning');
            this.log(`--- Planning iteration ${this.iterations} ---`);

            // Get LLM's plan/delegation
            const thought = await this.think();
            if (!thought) {
                return '❌ Failed to get response from LLM.';
            }

            // Check for completion
            if (thought.includes('```complete')) {
                this.setStatus('completed');
                const summary = this.extractSummary(thought);
                
                // Add TODO summary if any
                if (this.todoList.length > 0) {
                    const todoSummary = this.formatTodoList();
                    return `✅ ${summary}\n\n${todoSummary}`;
                }
                return `✅ ${summary}`;
            }

            // Check for delegation
            const delegation = this.parseDelegation(thought);
            if (!delegation) {
                // No delegation - prompt for action
                this.addMessage('user', 'Please delegate to an agent using ```delegate\n{"agent": "type", "task": "description"}\n``` or mark complete with ```complete```', true);
                continue;
            }

            // Execute delegation
            const result = await this.executeDelegation(delegation);
            
            // Feed result back to planner
            this.addMessage('user', result.message, true);
        }

        this.setStatus('error');
        return `⚠️ Max iterations (${this.config.maxIterations}) reached.\n\n${this.formatTodoList()}`;
    }

    /**
     * Think = make one LLM call to the planner
     */
    private async think(): Promise<string> {
        if (!this.hfProvider) return '';

        let response = '';
        this._onThought.fire('\n🧠 Planning...');

        try {
            for await (const chunk of this.hfProvider.streamChat(
                this.config.cloudModel,
                this.messages.map(m => ({ role: m.role, content: m.content })),
                { maxTokens: 1500, temperature: 0.3 }
            )) {
                if (this.abortController?.signal.aborted) break;
                response += chunk;
                // Don't stream raw LLM output - it contains code blocks
            }

            // Extract clean explanation (text before any code block)
            const cleanPlan = this.extractCleanPlan(response);
            if (cleanPlan) {
                this._onThought.fire('\n' + cleanPlan);
            }

            this.addMessage('assistant', response);
            return response;
        } catch (err: any) {
            this.log(`LLM error: ${err.message}`);
            throw err;
        }
    }

    /**
     * Extract clean planning text from LLM response (strips code blocks)
     */
    private extractCleanPlan(response: string): string {
        // Get text before any code block
        const codeBlockStart = response.indexOf('```');
        let text = codeBlockStart > 0 ? response.substring(0, codeBlockStart) : response;

        // Clean up and limit length
        text = text.trim();
        if (text.length > 500) {
            text = text.substring(0, 500) + '...';
        }
        return text;
    }


    /**
     * Execute a delegation - spawn agent and wait for completion
     */
    private async executeDelegation(delegation: { agent: AgentType; task: string }): Promise<{ success: boolean; message: string }> {
        const taskKey = `${delegation.agent}:${delegation.task.substring(0, 50)}`;
        const attempts = (this.retryTracker.get(taskKey) || 0) + 1;
        this.retryTracker.set(taskKey, attempts);

        this.log(`Delegating to ${delegation.agent} (attempt ${attempts}/${MAX_RETRIES}): ${delegation.task}`);
        this._onThought.fire(`\n\n🚀 Spawning ${delegation.agent} agent (attempt ${attempts})...`);
        this.setStatus('delegating');

        try {
            // Spawn the specialized agent
            const agent = await this.agentManager!.spawnAgent({
                type: delegation.agent,
                task: delegation.task,
                maxIterations: 50  // Agents get fewer iterations than orchestrator
            });

            this._onAgentSpawned.fire({ agent, task: delegation.task });
            this._onThought.fire(`\n👷 ${agent.name} working on: ${delegation.task.substring(0, 60)}...`);
            this.setStatus('waiting');

            // Wait for agent to complete
            const result = await this.waitForAgent(agent.id);

            this._onAgentCompleted.fire({ 
                agent: result.agent, 
                success: result.success, 
                error: result.error 
            });

            if (result.success) {
                this._onThought.fire(`\n✅ ${agent.name} completed successfully`);
                this.retryTracker.delete(taskKey);  // Clear retry counter on success
                return {
                    success: true,
                    message: `✅ Agent ${delegation.agent} completed: ${delegation.task}\n\nResult: ${result.summary || 'Task completed successfully.'}\n\nWhat's next?`
                };
            } else {
                // Failed - check retry count
                if (attempts >= MAX_RETRIES) {
                    // Max retries reached - add to TODO
                    const todo: TodoItem = {
                        task: delegation.task,
                        agentType: delegation.agent,
                        error: result.error || 'Unknown error',
                        attempts,
                        timestamp: new Date()
                    };
                    this.todoList.push(todo);
                    this._onTodoAdded.fire(todo);
                    this._onThought.fire(`\n⚠️ Max retries reached - added to TODO list`);

                    return {
                        success: false,
                        message: `⚠️ Agent ${delegation.agent} failed after ${MAX_RETRIES} attempts.\nTask added to TODO list: "${delegation.task}"\nError: ${result.error}\n\nContinue with other tasks or mark complete.`
                    };
                } else {
                    // Can retry
                    this._onThought.fire(`\n❌ Failed (attempt ${attempts}/${MAX_RETRIES}) - will retry`);
                    return {
                        success: false,
                        message: `❌ Agent ${delegation.agent} failed (attempt ${attempts}/${MAX_RETRIES}).\nError: ${result.error}\n\nYou can:\n1. Retry with same approach\n2. Try a different approach\n3. Delegate to different agent\n4. Skip and continue`
                    };
                }
            }
        } catch (err: any) {
            this.log(`Delegation error: ${err.message}`);
            return {
                success: false,
                message: `❌ Failed to spawn agent: ${err.message}`
            };
        }
    }

    /**
     * Wait for an agent to complete (success, error, or stopped)
     * MEMORY LEAK FIX: Properly clear both interval and timeout on all exit paths
     */
    private waitForAgent(agentId: string): Promise<{ success: boolean; agent: Agent; error?: string; summary?: string }> {
        return new Promise((resolve) => {
            let resolved = false;
            let checkInterval: NodeJS.Timeout | null = null;
            let timeoutId: NodeJS.Timeout | null = null;
            
            const cleanup = () => {
                if (checkInterval) {
                    clearInterval(checkInterval);
                    checkInterval = null;
                }
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
            };
            
            const safeResolve = (result: { success: boolean; agent: Agent; error?: string; summary?: string }) => {
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve(result);
            };
            
            checkInterval = setInterval(() => {
                const agent = this.agentManager!.getAgent(agentId);
                if (!agent) {
                    safeResolve({ success: false, agent: {} as Agent, error: 'Agent not found' });
                    return;
                }

                if (agent.status === 'completed') {
                    const lastTool = agent.toolHistory[agent.toolHistory.length - 1];
                    const summary = lastTool?.result?.output?.substring(0, 200) || 'Completed';
                    safeResolve({ success: true, agent, summary });
                } else if (agent.status === 'error' || agent.status === 'stopped') {
                    const lastTool = agent.toolHistory[agent.toolHistory.length - 1];
                    const error = lastTool?.result?.error || `Agent ${agent.status}`;
                    safeResolve({ success: false, agent, error });
                }
                // Keep waiting if running or waiting_user
            }, 500);

            // Timeout after 5 minutes
            timeoutId = setTimeout(() => {
                const agent = this.agentManager!.getAgent(agentId);
                this.agentManager!.stopAgent(agentId);
                safeResolve({ 
                    success: false, 
                    agent: agent || {} as Agent, 
                    error: 'Agent timed out after 5 minutes' 
                });
            }, 5 * 60 * 1000);
        });
    }


    /**
     * Parse delegation from LLM response
     */
    private parseDelegation(response: string): { agent: AgentType; task: string } | null {
        const match = response.match(/```delegate\s*\n?\s*(\{[\s\S]*?\})\s*\n?```/);
        if (!match) return null;

        try {
            const parsed = JSON.parse(match[1]);
            const validAgents: AgentType[] = ['frontend', 'backend', 'testing', 'browser', 'cleaner', 'general'];
            
            if (!parsed.agent || !validAgents.includes(parsed.agent)) {
                this.log(`Invalid agent type: ${parsed.agent}`);
                return null;
            }
            if (!parsed.task || typeof parsed.task !== 'string') {
                this.log('Missing or invalid task');
                return null;
            }

            return { agent: parsed.agent, task: parsed.task };
        } catch (err) {
            this.log(`Failed to parse delegation: ${err}`);
            return null;
        }
    }

    /**
     * Extract summary from completion message
     */
    private extractSummary(response: string): string {
        const match = response.match(/```complete\s*\n?([\s\S]*?)(?:```|$)/);
        if (match && match[1].trim()) {
            return match[1].trim();
        }
        // Fallback - get text before the complete block
        const parts = response.split('```complete');
        return parts[0].trim() || 'Task completed.';
    }

    /**
     * Format TODO list for output
     */
    private formatTodoList(): string {
        if (this.todoList.length === 0) return '';

        const items = this.todoList.map((t, i) => 
            `${i + 1}. [${t.agentType}] ${t.task}\n   Error: ${t.error}\n   Failed ${t.attempts} times`
        ).join('\n\n');

        return `📋 **TODO LIST** (tasks that need manual attention):\n\n${items}`;
    }

    /**
     * Get current TODO list
     */
    getTodoList(): TodoItem[] {
        return [...this.todoList];
    }

    /**
     * Clear TODO list
     */
    clearTodoList(): void {
        this.todoList = [];
    }


    /**
     * Abort current operation
     */
    abort(): void {
        this.abortController?.abort();
        this.setStatus('idle');
        this.log('Operation aborted');
    }

    /**
     * Reset conversation
     */
    reset(): void {
        this.messages = [{
            role: 'system',
            content: PLANNER_SYSTEM_PROMPT,
            timestamp: new Date()
        }];
        this.iterations = 0;
        this.retryTracker.clear();
        this.todoList = [];
        this.setStatus('idle');
        this.log('Conversation reset');
    }

    /**
     * Add message to conversation history
     */
    private addMessage(role: 'user' | 'assistant', content: string, isSystemFeedback: boolean = false): void {
        const msg: Message = { role, content, timestamp: new Date() };
        this.messages.push(msg);
        
        // Only fire event for real user/assistant messages, not internal feedback
        if (!isSystemFeedback) {
            this._onMessage.fire(msg);
        }
    }

    /**
     * Set orchestrator status
     */
    private setStatus(status: OrchestratorStatus): void {
        this.status = status;
        this._onStatusChange.fire(status);
    }

    /**
     * Get current status
     */
    getStatus(): OrchestratorStatus {
        return this.status;
    }

    /**
     * Get message history
     */
    getMessages(): Message[] {
        return [...this.messages];
    }

    /**
     * Log to output channel
     */
    private log(message: string): void {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    /**
     * Show output channel
     */
    showOutput(): void {
        this.outputChannel.show();
    }

    /**
     * Clear conversation history (alias for reset)
     */
    clearHistory(): void {
        this.reset();
    }

    /**
     * Buffer a thought chunk and schedule flush
     */
    private bufferThought(chunk: string): void {
        this.streamBuffer += chunk;
        if (!this.streamFlushTimer) {
            this.streamFlushTimer = setTimeout(() => this.flushThoughtBuffer(), this.STREAM_FLUSH_MS);
        }
    }

    /**
     * Flush the thought buffer to emit batched content
     */
    private flushThoughtBuffer(): void {
        if (this.streamBuffer) {
            this._onThought.fire(this.streamBuffer);
            this.streamBuffer = '';
        }
        if (this.streamFlushTimer) {
            clearTimeout(this.streamFlushTimer);
            this.streamFlushTimer = null;
        }
    }

    /**
     * Cleanup
     */
    dispose(): void {
        this.abort();
        this.flushThoughtBuffer(); // Flush any remaining content
        this._onMessage.dispose();
        this._onStatusChange.dispose();
        this._onAgentSpawned.dispose();
        this._onAgentCompleted.dispose();
        this._onTodoAdded.dispose();
        this._onThought.dispose();
        this.outputChannel.dispose();
    }
}
