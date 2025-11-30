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
import { getMcpRouter } from './mcp';
import { AppBuilderOrchestrator } from './appBuilder/appBuilderOrchestrator';

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

function buildPlannerSystemPrompt(mcpTools?: string): string {
    return `You are the Liftoff Orchestrator - a PROJECT MANAGER reporting to the CEO (user).

## YOUR ROLE: PROJECT MANAGER
Think of the hierarchy:
- **CEO (User)** - Gives high-level vision and requirements
- **YOU (Project Manager)** - Plans, delegates, tracks progress, reports status
- **Agents (Workers)** - Execute specific technical tasks

You are the PROJECT MANAGER. You:
✅ Break down CEO's vision into actionable tasks
✅ Research best approaches (using documentation tools)
✅ Delegate work to specialized workers (agents)
✅ Track what's DONE and what's NOT DONE
✅ Report progress and next steps to CEO
✅ Intervene when workers get stuck
✅ Make architectural decisions
✅ Keep the big picture in mind

You CANNOT do the actual coding/work yourself:
❌ Don't write files yourself - DELEGATE to agents
❌ Don't run commands yourself - DELEGATE to agents
❌ Don't execute code yourself - DELEGATE to agents

**Example PM thinking:**
"CEO wants recipe app. I need to:
1. ✅ DONE: Research React/Supabase best practices
2. ✅ DONE: Plan database schema
3. 🔄 IN PROGRESS: Frontend agent building UI components
4. ⏳ TODO: Backend agent setting up Supabase
5. ⏳ TODO: Testing agent writing tests

Next step: Wait for frontend agent to finish, then delegate Supabase setup to backend agent."

**Remember:** You track the project, agents do the work.

## CRITICAL: RESEARCH FIRST, THEN DELEGATE
BEFORE delegating ANY task, you MUST research:
1. **Use research tools ONLY (resolve-library-id, get-library-docs)**
   - React, Supabase, Tailwind, shadcn/ui, etc.
   - Get current APIs, best practices, latest patterns
2. **Make informed architectural decisions**
   - Choose the RIGHT tech stack based on requirements
   - Don't assume - research what's best for THIS specific use case
3. **Provide agents with enriched context**
   - Include relevant docs snippets in delegation tasks
   - Reference specific APIs/patterns from research

## AVAILABLE AGENTS
- **frontend** 🎨 - React, Vue, CSS, HTML, UI components, styling
- **backend** ⚙️ - APIs, databases, Python, Node.js servers, business logic
- **testing** 🧪 - Run tests, fix test failures, write new tests
- **browser** 🌐 - Playwright automation, UI testing, screenshots
- **cleaner** 🧹 - Remove dead code, fix linting, format files
- **general** 🔧 - File operations, git, misc tasks that don't fit above

## HOW TO USE TOOLS
Use this format to call MCP tools:
\`\`\`tool
{"name": "resolve-library-id", "params": {"library": "react"}}
\`\`\`
\`\`\`tool
{"name": "get-library-docs", "params": {"library_id": "...", "query": "..."}}
\`\`\`

**Available Tools:**
${mcpTools || 'Loading MCP tools...'}

## HOW TO DELEGATE
Output this EXACT format to assign work:
\`\`\`delegate
{"agent": "frontend", "task": "Create LoginForm using React hooks. Based on React docs, use useState for form state..."}
\`\`\`

## WORKFLOW
1. User gives you a task
2. **RESEARCH PHASE** - Use context7 to understand requirements
   - What libraries are best for this?
   - What are current best practices?
   - What APIs/patterns should we use?
3. **PLANNING PHASE** - Break down into steps with informed decisions
4. **DELEGATION PHASE** - For each step, delegate with enriched context
5. Wait for result, continue or retry
6. When ALL done: output \`\`\`complete\`\`\` with summary

## AGENT SUPERVISION
You can MONITOR agents in real-time:
- I'll alert you if an agent gets stuck (infinite loops, repeated errors, thrashing)
- You can see what agents are doing through their output streams
- If something goes wrong, you can KILL an agent and try a different approach

When an agent is stuck, you can:
1. Kill it and retry with clearer instructions
2. Kill it and delegate to a different agent type
3. Let it continue if you think it will recover

## PROGRESS TRACKING (Critical for PM Role)
After each agent completes or fails, you MUST provide a status update:

**Format:**
📊 **PROJECT STATUS:**
✅ Completed: [list what's done]
🔄 In Progress: [current agent working]
⏳ Next Steps: [what needs to happen]
⚠️ Blockers: [any issues]

**Example:**
📊 **PROJECT STATUS:**
✅ Completed:
- Researched React 18 + Supabase stack
- Frontend agent created project structure
- Frontend agent set up Tailwind CSS

🔄 In Progress:
- Waiting for frontend agent to finish auth pages

⏳ Next Steps:
1. Backend agent: Set up Supabase database schema
2. Backend agent: Configure row-level security
3. Testing agent: Write auth flow tests

⚠️ Blockers: None

## CRITICAL: CHECK FOR .liftoff PLAN FILE FIRST
BEFORE doing ANYTHING, check if a .liftoff file exists in the working directory:

\`\`\`tool
{"name": "read_file", "params": {"path": ".liftoff"}}
\`\`\`

**If .liftoff EXISTS:**
- You are in APP BUILDER mode
- Follow the phase instructions in the file EXACTLY
- Use AppBuilderOrchestrator methods - DO NOT manually create files
- Update the .liftoff file as you progress through phases
- The file tells you EXACTLY what to do next

**If .liftoff DOES NOT exist:**
- Check if user wants to BUILD AN APP or EDIT CODE
- If building app: Create .liftoff file and enter APP BUILDER mode
- If editing code: Continue with normal delegation workflow

**APP BUILDER Mode vs CODE EDITING Mode:**
- **APP BUILDER**: "Build me a recipe app" → Use .liftoff phases
- **CODE EDITING**: "Fix the login bug" → Direct agent delegation

When in APP BUILDER mode, the .liftoff file contains:
- Current phase (spec, architecture, scaffold, implement, test, deploy)
- What to do in this phase
- What NOT to do (like manually creating files)
- When to move to next phase

**ALWAYS update .liftoff file after completing each phase:**
\`\`\`tool
{"name": "write_file", "params": {"path": ".liftoff", "content": "updated JSON"}}
\`\`\`

## RULES
- **ALWAYS check for .liftoff file first** - It keeps you on track
- **ALWAYS research BEFORE first delegation** - Use research tools to look up best stack
- ONE delegation at a time - wait for result before next
- **ALWAYS provide status update after each agent result**
- Include research findings in delegation tasks
- Be SPECIFIC and include relevant documentation references
- Monitor agent behavior - if stuck or misbehaving, intervene
- If an agent fails 3 times on same task, I'll mark it as TODO and you continue
- DON'T delegate tiny tasks - combine related work into meaningful chunks
- Think like a PM: What's done? What's next? What's blocking?

## EXAMPLE INTERACTION (APP BUILDER MODE)
**CEO (User):** "Build a recipe app with meal planning"

**You (PM):** Understood! First let me check if there's a .liftoff plan file.

\`\`\`tool
{"name": "read_file", "params": {"path": ".liftoff"}}
\`\`\`

[File not found - this is a new app build request]

**You (PM):** No .liftoff file found. This is a new app build request. I'll enter APP BUILDER mode and create the plan.

\`\`\`tool
{"name": "write_file", "params": {"path": ".liftoff", "content": "{...initial plan...}"}}
\`\`\`

📊 **ENTERING APP BUILDER MODE**
Phase: SPECIFICATION
Task: Generate AppSpec from description

I will use the AppBuilderOrchestrator.runSpecPhase() to:
1. Parse the description
2. Ask clarifying questions
3. Generate structured spec
4. Save to liftoff.spec.json

[Calling appBuilderOrchestrator.runSpecPhase()]

📊 **PHASE COMPLETE: SPECIFICATION**
✅ Generated: liftoff.spec.json
- App Type: SaaS
- Features: auth, database, file-upload
- Entities: Recipe, MealPlan, Ingredient, User
- Pages: /, /recipes, /meal-plan, /login, /signup

Updating .liftoff file to move to ARCHITECTURE phase...

\`\`\`tool
{"name": "write_file", "params": {"path": ".liftoff", "content": "{...updated with phase=architecture...}"}}
\`\`\`

📊 **PHASE: ARCHITECTURE**
Now generating system architecture from spec...

[This flow continues through all phases without manually creating files]

## EXAMPLE INTERACTION (CODE EDITING MODE)
**CEO (User):** "Fix the login validation bug"

**You (PM):** Let me check for .liftoff file first.

\`\`\`tool
{"name": "read_file", "params": {"path": ".liftoff"}}
\`\`\`

[File not found - this is code editing]

**You (PM):** No .liftoff file. This is CODE EDITING mode (not building a new app).

\`\`\`delegate
{"agent": "frontend", "task": "Find and fix the login validation bug in the authentication flow"}
\`\`\`
`;
}


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
    private agentOutputBuffers: Map<string, string[]> = new Map(); // Track agent outputs for supervision

    // Retry tracking: task -> attempt count
    private retryTracker: Map<string, number> = new Map();
    
    // TODO list for tasks that failed after max retries
    private todoList: TodoItem[] = [];

    // Agent pool management
    private activeAgents: Set<string> = new Set();
    private readonly MAX_CONCURRENT_AGENTS = 6;

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

        // Initialize with planner system prompt (includes MCP tools)
        const mcpRouter = getMcpRouter();
        const mcpToolsDescription = mcpRouter ? mcpRouter.getToolsCompact() : '';
        this.messages.push({
            role: 'system',
            content: buildPlannerSystemPrompt(mcpToolsDescription),
            timestamp: new Date()
        });

        this.log('Orchestrator initialized');
    }

    /**
     * Connect to the agent manager (call this after construction)
     */
    setAgentManager(manager: AutonomousAgentManager): void {
        this.agentManager = manager;

        // Subscribe to agent events for monitoring
        manager.onAgentOutput(({ agentId, content, type }) => {
            // Buffer agent outputs for orchestrator to review
            if (!this.agentOutputBuffers.has(agentId)) {
                this.agentOutputBuffers.set(agentId, []);
            }
            const buffer = this.agentOutputBuffers.get(agentId)!;
            buffer.push(`[${type}] ${content}`);

            // Keep last 50 messages per agent
            if (buffer.length > 50) {
                this.agentOutputBuffers.set(agentId, buffer.slice(-50));
            }
        });

        // Subscribe to stuck agent events - orchestrator can intervene
        manager.onAgentStuck(({ agentId, agent, reason, evidence, suggestion }) => {
            this.log(`⚠️ Agent ${agentId} stuck: ${reason}`);
            this._onThought.fire(`\n⚠️ Detected ${agent.name} is stuck: ${reason}\nEvidence: ${evidence.join(', ')}\nSuggestion: ${suggestion}`);
            // Orchestrator can decide to kill or let it continue
        });

        this.log('Agent manager connected with monitoring');
    }

    async setApiKey(apiKey: string): Promise<void> {
        this.hfProvider = new HuggingFaceProvider(apiKey);

        // Initialize MCP router with tools
        await this.initializeMcpTools();

        this.log('API key configured');
    }

    /**
     * Initialize MCP tools (context7, serena, etc.)
     */
    private async initializeMcpTools(): Promise<void> {
        this.log('=== MCP INITIALIZATION START ===');
        try {
            this.log(`1. Getting MCP router...`);
            const mcpRouter = getMcpRouter();
            
            this.log(`2. Loading config from: ${this.workspaceRoot}`);
            const configs = await mcpRouter.loadConfig(this.workspaceRoot);
            this.log(`   Found ${configs.length} server configs`);

            if (configs.length === 0) {
                this.log('   ⚠️ No MCP servers configured - skipping');
                return;
            }

            this.log(`3. Connecting to ${configs.length} servers...`);
            for (const cfg of configs) {
                this.log(`   - ${cfg.name}: ${cfg.command} ${cfg.args?.join(' ')}`);
            }
            
            await mcpRouter.connectAll(configs);
            this.log(`   ✓ All servers connected`);

            this.log(`4. Getting available tools...`);
            const mcpToolsDescription = mcpRouter.getToolsCompact();
            const toolCount = mcpToolsDescription.split('\n').filter(l => l.trim()).length;
            this.log(`   ✓ Found ${toolCount} tools`);
            this.log(`   Tools:\n${mcpToolsDescription}`);

            this.log(`5. Updating system prompt...`);
            const newPrompt = buildPlannerSystemPrompt(mcpToolsDescription);
            this.messages[0] = {
                role: 'system',
                content: newPrompt,
                timestamp: new Date()
            };
            this.log(`   ✓ System prompt updated (${newPrompt.length} chars)`);

            this.log(`=== MCP INITIALIZATION COMPLETE ===`);
            this.log(`   ${configs.length} servers, ${toolCount} tools ready`);
        } catch (err: any) {
            this.log(`✗ MCP initialization failed: ${err.message}`);
            this.log(`   Stack: ${err.stack}`);
        }
    }

    /**
     * Kill a misbehaving agent
     */
    killAgent(agentId: string, reason: string = 'Terminated by orchestrator'): void {
        if (!this.agentManager) return;

        const agent = this.agentManager.getAgent(agentId);
        if (agent) {
            this.log(`🔪 Killing agent ${agent.name}: ${reason}`);
            this._onThought.fire(`\n🔪 Terminating ${agent.name}: ${reason}`);
            this.agentManager.killAgent(agentId);
            this.activeAgents.delete(agentId);
            this.agentOutputBuffers.delete(agentId);
        }
    }

    /**
     * Get agent's recent output (for supervision)
     */
    getAgentOutput(agentId: string): string[] {
        return this.agentOutputBuffers.get(agentId) || [];
    }

    /**
     * Get all running agents
     */
    getRunningAgents(): Agent[] {
        if (!this.agentManager) return [];
        return this.agentManager.getRunningAgents();
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
            // CRITICAL: Detect if this is an app building request
            const isAppBuildRequest = this.detectAppBuildRequest(userMessage);

            if (isAppBuildRequest) {
                this.log('🎯 Detected APP BUILD request - entering AppBuilder mode');
                return await this.handleAppBuild(userMessage);
            }

            // Normal code editing flow
            this.log('🔧 CODE EDITING mode - using normal delegation');
            return await this.planningLoop();
        } catch (err: any) {
            this.setStatus('error');
            return `❌ Error: ${err.message}`;
        }
    }

    /**
     * Detect if user wants to build a new app vs edit existing code
     */
    private detectAppBuildRequest(message: string): boolean {
        const msg = message.toLowerCase();

        // Strong indicators of app building
        const buildIndicators = [
            'build me',
            'build a',
            'build an',
            'create a new app',
            'create an app',
            'make me a',
            'make me an',
            'make a new',
            'create a project',
            'build a project',
            'scaffold',
            'generate an app',
            'generate a new',
            'i want to build',
            'i want an app',
            'i need an app',
            'develop a new app',
            'develop an app',
            'start a new project',
            'new application'
        ];

        // Check for build indicators
        const hasBuildIndicator = buildIndicators.some(indicator => msg.includes(indicator));

        // Keywords that suggest it's an app description, not code editing
        const appKeywords = [
            'with authentication',
            'with auth',
            'user login',
            'database',
            'supabase',
            'real-time',
            'file upload',
            'payments',
            'shopping cart',
            'dashboard',
            'admin panel',
            'calendar',
            'chat feature',
            'social media',
            'ecommerce',
            'blog platform',
            'landing page'
        ];

        const hasAppKeywords = appKeywords.some(kw => msg.includes(kw));

        // App type keywords
        const appTypes = [
            'saas',
            'crud app',
            'e-commerce',
            'ecommerce',
            'marketplace',
            'portfolio site',
            'blog',
            'cms',
            'social network',
            'task manager',
            'todo app',
            'project management',
            'booking system',
            'reservation',
            'recipe app',
            'fitness tracker',
            'habit tracker'
        ];

        const hasAppType = appTypes.some(type => msg.includes(type));

        // Code editing indicators (should NOT trigger app build)
        const editIndicators = [
            'fix the',
            'debug',
            'refactor',
            'update the',
            'change the',
            'modify',
            'add a function',
            'add a method',
            'improve the',
            'optimize',
            'bug in',
            'error in',
            'issue with'
        ];

        const hasEditIndicator = editIndicators.some(indicator => msg.includes(indicator));

        // Decision logic
        if (hasEditIndicator) {
            return false; // Definitely code editing
        }

        if (hasBuildIndicator) {
            return true; // Explicit build request
        }

        if (hasAppType && hasAppKeywords) {
            return true; // Describing an app to build
        }

        // Default to code editing if unclear
        return false;
    }

    /**
     * Handle app building using AppBuilderOrchestrator
     */
    private async handleAppBuild(userMessage: string): Promise<string> {
        this.log('📋 Starting AppBuilder workflow...');

        // Ask user where to create the project
        const defaultDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
                          this.workspaceRoot;

        const targetFolder = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select Project Location',
            defaultUri: vscode.Uri.file(defaultDir)
        });

        if (!targetFolder || targetFolder.length === 0) {
            return '❌ App build cancelled - no folder selected';
        }

        const targetDir = targetFolder[0].fsPath;
        this.log(`Target directory: ${targetDir}`);

        // Create AppBuilderOrchestrator and run
        const extensionPath = vscode.extensions.getExtension('anthropic.liftoff')?.extensionPath || '';
        const appBuilder = new AppBuilderOrchestrator(extensionPath, this);

        this._onThought.fire('\n📋 **ENTERING APP BUILDER MODE**\n');
        this._onThought.fire('Following structured workflow: SPEC → ARCHITECTURE → SCAFFOLD → IMPLEMENT → TEST → DEPLOY\n\n');

        try {
            const result = await appBuilder.buildApp(userMessage, targetDir);

            if (result.success) {
                let summary = `✅ **App Build Complete!**\n\n`;
                summary += `📁 Project: ${result.projectPath}\n`;

                if (result.spec) {
                    summary += `📋 Spec: ${result.spec.displayName}\n`;
                    summary += `🔧 Features: ${result.spec.features.join(', ')}\n`;
                }

                if (result.deployUrl) {
                    summary += `\n🚀 Deployed: ${result.deployUrl}\n`;
                }

                if (result.todoItems.length > 0) {
                    summary += `\n⚠️ TODO Items:\n${result.todoItems.map(t => `  - ${t}`).join('\n')}\n`;
                }

                return summary;
            } else {
                return `❌ App build failed: ${result.error || 'Unknown error'}`;
            }
        } catch (error: any) {
            this.log(`App build error: ${error.message}`);
            return `❌ App build failed: ${error.message}`;
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

            // Check for tool call (research)
            const toolCall = this.parseToolCall(thought);
            if (toolCall) {
                this.log(`Tool call: ${toolCall.name}`);
                const toolResult = await this.executeToolCall(toolCall);
                this.addMessage('user', `Tool result: ${toolResult}`, true);
                continue;
            }

            // Check for delegation
            const delegation = this.parseDelegation(thought);
            if (!delegation) {
                // No action - prompt for what to do next
                this.addMessage('user', 'Please use a tool to research, delegate to an agent, or mark complete with ```complete```', true);
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

        // Check agent pool limit
        if (this.activeAgents.size >= this.MAX_CONCURRENT_AGENTS) {
            this._onThought.fire(`\n⏸️ Agent pool full (${this.activeAgents.size}/${this.MAX_CONCURRENT_AGENTS}). Waiting for an agent to complete...`);
            this.log(`Agent pool limit reached, waiting...`);

            // Wait a bit for agents to complete
            await new Promise(resolve => setTimeout(resolve, 2000));

            // If still full, fail gracefully
            if (this.activeAgents.size >= this.MAX_CONCURRENT_AGENTS) {
                return {
                    success: false,
                    message: `⚠️ Too many concurrent agents (${this.activeAgents.size}). Please wait for current tasks to complete before delegating more work.`
                };
            }
        }

        this.log(`Delegating to ${delegation.agent} (attempt ${attempts}/${MAX_RETRIES}): ${delegation.task}`);
        this._onThought.fire(`\n\n🚀 Spawning ${delegation.agent} agent (attempt ${attempts})... [${this.activeAgents.size + 1}/${this.MAX_CONCURRENT_AGENTS} active]`);
        this.setStatus('delegating');

        try {
            // Spawn the specialized agent
            const agent = await this.agentManager!.spawnAgent({
                type: delegation.agent,
                task: delegation.task,
                maxIterations: 50  // Agents get fewer iterations than orchestrator
            });

            // Track active agent
            this.activeAgents.add(agent.id);

            this._onAgentSpawned.fire({ agent, task: delegation.task });
            this._onThought.fire(`\n👷 ${agent.name} working on: ${delegation.task.substring(0, 60)}...`);
            this.setStatus('waiting');

            // Wait for agent to complete
            const result = await this.waitForAgent(agent.id);

            // Remove from active pool
            this.activeAgents.delete(agent.id);

            this._onAgentCompleted.fire({
                agent: result.agent,
                success: result.success,
                error: result.error
            });

            if (result.success) {
                this._onThought.fire(`\n✅ ${agent.name} completed successfully [${this.activeAgents.size}/${this.MAX_CONCURRENT_AGENTS} active]`);
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
            // Note: Agent may not have been added to activeAgents if spawn failed
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
     * Parse tool call from LLM response
     */
    private parseToolCall(response: string): { name: string; params: any } | null {
        const match = response.match(/```tool\s*\n?\s*(\{[\s\S]*?\})\s*\n?```/);
        if (!match) {
            // Check if response mentions tools without proper format
            if (response.toLowerCase().includes('resolve-library') || 
                response.toLowerCase().includes('get-library-docs') ||
                response.toLowerCase().includes('```tool')) {
                this.log(`⚠️ Response mentions tools but format doesn't match. Response preview: ${response.substring(0, 500)}`);
            }
            return null;
        }

        try {
            const parsed = JSON.parse(match[1]);
            if (!parsed.name || typeof parsed.name !== 'string') {
                this.log('✗ Missing or invalid tool name in parsed JSON');
                return null;
            }
            this.log(`✓ Parsed tool call: ${parsed.name}`);
            return { name: parsed.name, params: parsed.params || {} };
        } catch (err) {
            this.log(`✗ Failed to parse tool call JSON: ${err}`);
            this.log(`   Matched text: ${match[1]}`);
            return null;
        }
    }

    /**
     * Execute a tool call using MCP router
     */
    private async executeToolCall(toolCall: { name: string; params: any }): Promise<string> {
        this.log(`=== TOOL CALL: ${toolCall.name} ===`);
        this.log(`   Params: ${JSON.stringify(toolCall.params)}`);
        this._onThought.fire(`\n🔧 Researching: ${toolCall.name}...`);

        try {
            const mcpRouter = getMcpRouter();
            if (!mcpRouter) {
                this.log('   ✗ ERROR: MCP router not initialized');
                return 'Error: MCP router not initialized';
            }

            this.log(`   Router ready, calling tool...`);
            const result = await mcpRouter.callTool(toolCall.name, toolCall.params);

            this.log(`   Success: ${result.success}`);
            if (result.success) {
                this.log(`   Output length: ${result.output?.length || 0} chars`);
                this.log(`   Output preview: ${result.output?.substring(0, 200)}`);
            } else {
                this.log(`   Error: ${result.error}`);
                return `Error: ${result.error || 'Tool execution failed'}`;
            }

            // Truncate if very long
            const resultStr = result.output || '';

            if (resultStr.length > 2000) {
                this.log(`   Truncating output from ${resultStr.length} to 2000 chars`);
                return resultStr.substring(0, 2000) + '\n... (truncated)';
            }
            
            this.log(`=== TOOL CALL COMPLETE ===`);
            return resultStr;
        } catch (err: any) {
            this.log(`✗ Tool execution error: ${err.message}`);
            this.log(`   Stack: ${err.stack}`);
            return `Error: ${err.message}`;
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
        const mcpRouter = getMcpRouter();
        const mcpToolsDescription = mcpRouter ? mcpRouter.getToolsCompact() : '';
        this.messages = [{
            role: 'system',
            content: buildPlannerSystemPrompt(mcpToolsDescription),
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
