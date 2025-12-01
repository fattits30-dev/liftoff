import * as vscode from 'vscode';
import { HuggingFaceProvider, HFMessage } from './hfProvider';
import { OllamaProvider } from './ollamaProvider';
import { ToolResult } from './tools';
import { LessonsManager } from './tools/lessons';
import { Artifact } from './agentCommunication';
import { getMcpRouter, McpRouter, disposeMcpRouter, disposeMcpOutputChannel } from './mcp';
import { AgentMemory, SemanticMemoryStore } from './memory/agentMemory';
import {
    DEFAULT_CLOUD_MODEL_NAME,
    DEFAULT_OLLAMA_MODEL_NAME,
    DEFAULT_PROVIDER,
    API_ENDPOINTS,
    LIMITS,
    LLMProvider,
    AGENT_MODEL_PARAMS
} from './config';
import { buildAgentSystemPrompt } from './config/prompts';
import { AgentType, AgentStatus } from './types/agentTypes';
import { UnifiedAgentView } from './unifiedAgentView';
import { LoopDetector } from './collaboration/loopDetector';
export { AgentType, AgentStatus } from './types/agentTypes';

export interface Agent {
    id: string;
    type: AgentType;
    status: AgentStatus;
    name: string;
    task: string;
    model: string;
    messages: HFMessage[];
    artifacts: Artifact[];
    toolHistory: Array<{ tool: string; params: any; result: ToolResult }>;
    iterations: number;
    startTime: Date;
    endTime?: Date;
    abortController?: AbortController;
    maxIterations?: number;
}

const AGENT_EMOJIS: Record<AgentType, string> = {
    frontend: '🎨',
    backend: '⚙️',
    testing: '🧪',
    browser: '🌐',
    general: '🔧',
    cleaner: '🧹'
};

/**
 * Manages autonomous agent lifecycle, execution, and monitoring
 *
 * @remarks
 * This class handles:
 * - Agent spawning and lifecycle management
 * - LLM provider configuration (Ollama/HuggingFace)
 * - Tool execution via MCP router
 * - Agent supervision and loop detection
 * - Memory system integration
 * - Event-driven UI updates via unified agent view
 *
 * Agents run autonomously in a loop:
 * 1. LLM generates response (streamed)
 * 2. Parse tool calls from response
 * 3. Execute tools via MCP
 * 4. Feed results back to LLM
 * 5. Repeat until task complete, error, or max iterations
 *
 * @example
 * ```typescript
 * const manager = new AutonomousAgentManager(context);
 * await manager.setApiKey('hf_...');
 * const agent = await manager.spawnAgent({
 *   type: 'frontend',
 *   task: 'Create LoginForm component'
 * });
 * ```
 */
export class AutonomousAgentManager {
    private llmProvider: HuggingFaceProvider | OllamaProvider | null = null;
    private providerType: LLMProvider = DEFAULT_PROVIDER;
    private mcpRouter: McpRouter | null = null;
    private mcpInitialized = false;
    private agents: Map<string, Agent> = new Map();
    private outputChannel: vscode.OutputChannel;
    private defaultModel: string = DEFAULT_OLLAMA_MODEL_NAME; // Changed default to Ollama
    private lessons: LessonsManager;
    private pendingErrors: Map<string, { error: string; context: string; timestamp: number }> = new Map();

    // Track consecutive iterations without tool calls per agent
    private noToolCounts: Map<string, number> = new Map();

    // Prevent race conditions - track which agents have active loops
    private activeLoops: Set<string> = new Set();

    // Memory system - dedicated memory for each agent
    private semanticMemory: SemanticMemoryStore | null = null;
    private agentMemories: Map<string, AgentMemory> = new Map();

    // Unified agent view (single panel for all agents)
    private unifiedView: UnifiedAgentView;
    private extensionUri: vscode.Uri;

    // Loop detection
    private loopDetector: LoopDetector = new LoopDetector();

    private readonly _onAgentUpdate = new vscode.EventEmitter<Agent>();
    public readonly onAgentUpdate = this._onAgentUpdate.event;
    private readonly _onAgentOutput = new vscode.EventEmitter<{ agentId: string; content: string; type: 'thought' | 'tool' | 'result' | 'error' }>();
    public readonly onAgentOutput = this._onAgentOutput.event;

    // Event-driven completion
    private readonly _onAgentComplete = new vscode.EventEmitter<{ agentId: string; status: AgentStatus; agent: Agent }>();
    public readonly onAgentComplete = this._onAgentComplete.event;

    // Agent stuck event - fires when loop detected, orchestrator should handle
    private readonly _onAgentStuck = new vscode.EventEmitter<{
        agentId: string;
        agent: Agent;
        reason: string;
        evidence: string[];
        suggestion: string;
    }>();
    public readonly onAgentStuck = this._onAgentStuck.event;

    // Tool execution events for UI
    private readonly _onToolStart = new vscode.EventEmitter<{ tool: string; params: Record<string, unknown> }>();
    public readonly onToolStart = this._onToolStart.event;
    private readonly _onToolComplete = new vscode.EventEmitter<{ tool: string; success: boolean; output: string; duration: number }>();
    public readonly onToolComplete = this._onToolComplete.event;

    private workspaceRoot: string;

    /**
     * Create a new agent manager instance
     *
     * @param context - VS Code extension context
     * @param semanticMemory - Optional semantic memory store for agent memory system
     *
     * @remarks
     * Initializes:
     * - Unified agent view (webview panel)
     * - MCP router with local tools (file operations, etc.)
     * - Lessons manager for error recovery
     * - Event subscriptions for UI updates
     *
     * External MCP servers are loaded asynchronously after construction.
     */
    constructor(context: vscode.ExtensionContext, semanticMemory?: SemanticMemoryStore) {
        this.extensionUri = context.extensionUri;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        this.workspaceRoot = workspaceFolders?.[0]?.uri.fsPath || process.cwd();

        this.outputChannel = vscode.window.createOutputChannel('Liftoff Agents');

        // Initialize unified agent view (single panel for all agents)
        this.unifiedView = new UnifiedAgentView(this.extensionUri);
        this.lessons = new LessonsManager(this.workspaceRoot);

        if (semanticMemory) {
            this.semanticMemory = semanticMemory;
            this.outputChannel.appendLine('[AgentManager] Memory system initialized');
        }

        // Initialize MCP router immediately with workspace root for local tools
        this.initMcpRouterWithWorkspace();

        // Wire up unified view event forwarding
        this.onAgentOutput(({ agentId, content, type }) => {
            this.unifiedView.appendOutput(agentId, content, type);
        });

        this.onAgentUpdate((agent) => {
            this.unifiedView.updateAgent(agent);
        });

        this.onToolStart(({ tool: _tool, params: _params }) => {
            // Tool start events are captured via onToolComplete with full data
        });

        this.onToolComplete(({ tool, success, output: _output, duration: _duration }) => {
            // Find which agent executed this tool (most recent active agent)
            for (const [agentId, agent] of this.agents) {
                if (agent.status === 'running' && agent.toolHistory.length > 0) {
                    const lastTool = agent.toolHistory[agent.toolHistory.length - 1];
                    if (lastTool.tool === tool) {
                        this.unifiedView.appendToolExecution(
                            agentId,
                            tool,
                            lastTool.params,
                            success ? lastTool.result.output : undefined,
                            success ? undefined : lastTool.result.error
                        );
                        break;
                    }
                }
            }
        });
    }

    /**
     * Initialize MCP router with workspace root (called in constructor)
     * This ensures local tools are always available immediately
     */
    private initMcpRouterWithWorkspace(): void {
        this.mcpRouter = getMcpRouter();

        // Initialize local tools synchronously - this is fast and makes them immediately available
        this.mcpRouter.initializeLocalToolsSync(this.workspaceRoot);

        // Mark as initialized now that local tools are ready
        this.mcpInitialized = true;
        this.outputChannel.appendLine('[AgentManager] MCP Router initialized with local tools');

        // Load and connect to external MCP servers asynchronously
        this.loadMcpServersAsync();
    }

    /**
     * Async initialization of external MCP servers (Serena, filesystem, etc.)
     */
    private async loadMcpServersAsync(): Promise<void> {
        try {
            if (!this.mcpRouter) return;
            const configs = await this.mcpRouter.loadConfig(this.workspaceRoot);

            if (configs.length > 0) {
                // connectAll will skip local tools since they're already initialized
                await this.mcpRouter.connectAll(configs);
                this.outputChannel.appendLine(`[AgentManager] Connected to ${configs.length} external MCP server(s)`);
            } else {
                this.outputChannel.appendLine(`[AgentManager] No external MCP servers configured`);
            }
        } catch (err: any) {
            this.outputChannel.appendLine(`[AgentManager] External MCP servers initialization failed: ${err.message}`);
        }
    }

    /**
     * Configure the LLM provider with an API key
     *
     * @param apiKey - API key for the configured provider (HuggingFace or empty for Ollama)
     *
     * @remarks
     * Provider type is determined by `liftoff.llmProvider` setting:
     * - `ollama`: Uses local/cloud Ollama instance (no API key needed)
     * - `huggingface`: Uses HuggingFace Router API
     *
     * For Ollama, agents can use a different model than the orchestrator
     * via the `liftoff.ollamaAgentModel` setting (e.g., fast local model for agents).
     *
     * Also initializes MCP router with external servers after provider is set.
     *
     * @example
     * ```typescript
     * // HuggingFace
     * await manager.setApiKey('hf_...');
     *
     * // Ollama
     * await manager.setApiKey('');
     * ```
     */
    async setApiKey(apiKey: string): Promise<void> {
        // Get provider preference from settings
        const config = vscode.workspace.getConfiguration('liftoff');
        this.providerType = config.get<LLMProvider>('llmProvider', DEFAULT_PROVIDER);

        if (this.providerType === 'ollama') {
            // Use Ollama - no API key needed
            const ollamaBaseUrl = config.get<string>('ollamaBaseUrl', API_ENDPOINTS.ollama);
            // Agents use the dedicated agent model setting (can be local for speed)
            const ollamaAgentModel = config.get<string>('ollamaAgentModel', 'deepseek-coder:6.7b');

            this.llmProvider = new OllamaProvider(ollamaBaseUrl, ollamaAgentModel);
            this.defaultModel = ollamaAgentModel;

            const isLocal = !ollamaAgentModel.includes('cloud');
            const emoji = isLocal ? '💻' : '☁️';
            this.outputChannel.appendLine(`[AgentManager] ${emoji} Using Ollama at ${ollamaBaseUrl} with ${isLocal ? 'LOCAL' : 'CLOUD'} model ${ollamaAgentModel}`);
        } else {
            // Use HuggingFace cloud provider
            this.llmProvider = new HuggingFaceProvider(apiKey);
            this.defaultModel = DEFAULT_CLOUD_MODEL_NAME;
            this.outputChannel.appendLine('[AgentManager] ☁️ Using HuggingFace cloud provider');
        }

        await this.initMcpRouter();
    }

    private async initMcpRouter(): Promise<void> {
        try {
            this.mcpRouter = getMcpRouter();
            const configs = await this.mcpRouter.loadConfig(this.workspaceRoot);
            if (configs.length > 0) {
                await this.mcpRouter.connectAll(configs);
                this.mcpInitialized = true;
                this.outputChannel.appendLine(`[AgentManager] MCP Router initialized with ${configs.length} server(s)`);
            }
        } catch (err: any) {
            this.outputChannel.appendLine(`[AgentManager] MCP init failed: ${err.message}`);
        }
    }

    setModel(model: string): void {
        this.defaultModel = model;
        this.outputChannel.appendLine(`[AgentManager] Default model set to: ${model}`);
    }

    /**
     * Spawn a new autonomous agent to work on a task
     *
     * @param options - Agent configuration
     * @param options.type - Agent type ('frontend', 'backend', 'testing', 'browser', 'cleaner', 'general')
     * @param options.task - Task description for the agent
     * @param options.model - Optional model override (uses default if not specified)
     * @param options.maxIterations - Optional max iterations (default: 50)
     * @returns The spawned agent instance
     *
     * @remarks
     * The agent runs autonomously in a loop:
     * 1. Streams LLM response
     * 2. Parses tool calls from response
     * 3. Executes tools via MCP
     * 4. Feeds results back to LLM
     * 5. Detects completion, errors, or infinite loops
     *
     * Agent types have specialized system prompts:
     * - **frontend**: React, CSS, UI components, styling
     * - **backend**: APIs, databases, business logic, servers
     * - **testing**: Running tests, fixing test failures
     * - **browser**: Playwright automation, UI testing
     * - **cleaner**: Dead code removal, linting, formatting
     * - **general**: File operations, git, miscellaneous tasks
     *
     * The agent runs in the background. Use events to monitor progress:
     * - `onAgentUpdate`: Status changes
     * - `onAgentOutput`: Streaming thoughts/tool calls
     * - `onAgentComplete`: Final completion/error
     *
     * @example
     * ```typescript
     * const agent = await manager.spawnAgent({
     *   type: 'frontend',
     *   task: 'Create a LoginForm component with email and password fields',
     *   maxIterations: 30
     * });
     *
     * manager.onAgentComplete(({ agentId, status, agent }) => {
     *   console.log(`Agent ${agentId} finished with status: ${status}`);
     * });
     * ```
     */
    async spawnAgent(options: {
        type: AgentType;
        task: string;
        model?: string;
        maxIterations?: number;
    }): Promise<Agent> {
        const { type, task, model, maxIterations } = options;
        const id = `agent-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        const actualModel = model || this.defaultModel;

        const systemPrompt = buildAgentSystemPrompt(type, '');

        const agent: Agent = {
            id,
            type,
            status: 'idle',
            name: `${AGENT_EMOJIS[type]} ${type.charAt(0).toUpperCase() + type.slice(1)}`,
            task,
            model: actualModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: task }
            ],
            artifacts: [],
            toolHistory: [],
            iterations: 0,
            startTime: new Date(),
            abortController: new AbortController(),
            maxIterations: maxIterations || LIMITS.maxIterations,
        };

        this.agents.set(id, agent);
        this._onAgentUpdate.fire(agent);

        // Add agent to unified view
        this.unifiedView.addAgent(agent);
        this.unifiedView.show();

        this.outputChannel.appendLine(`[AgentManager] Spawned ${agent.name} with task: ${task}`);

        this.runAgentLoop(id).catch(err => {
            this.outputChannel.appendLine(`[AgentManager] FATAL: Agent loop crashed for ${id}: ${err.message}`);
            const failedAgent = this.agents.get(id);
            if (failedAgent) {
                failedAgent.status = 'error';
                failedAgent.endTime = new Date();
                this._onAgentUpdate.fire(failedAgent);
                this._onAgentComplete.fire({ agentId: id, status: 'error', agent: failedAgent });
            }
        });

        return agent;
    }


    private async runAgentLoop(agentId: string): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) return;

        // RACE CONDITION FIX: Prevent multiple loops for same agent
        if (this.activeLoops.has(agentId)) {
            this.outputChannel.appendLine(`[AgentManager] Loop already active for ${agentId}, skipping`);
            return;
        }
        this.activeLoops.add(agentId);

        if (!this.llmProvider) {
            this.emit(agentId, '❌ LLM provider not configured', 'error');
            agent.status = 'error';
            this.activeLoops.delete(agentId);
            return;
        }

        agent.status = 'running';
        this._onAgentUpdate.fire(agent);

        try {
            const maxIter = agent.maxIterations || LIMITS.maxIterations;
            while (agent.iterations < maxIter && agent.status === 'running') {
                if (agent.abortController?.signal.aborted) {
                    agent.status = 'stopped';
                    this.emit(agentId, '\n🛑 Agent stopped by user', 'error');
                    break;
                }

                agent.iterations++;
                this.log(agent, `--- Iteration ${agent.iterations} ---`);

                let response = '';
                this.emit(agentId, '\n\n💭 ', 'thought');

                try {
                    for await (const chunk of this.llmProvider.streamChat(
                        agent.model,
                        agent.messages,
                        AGENT_MODEL_PARAMS
                    )) {
                        if (agent.abortController?.signal.aborted) {
                            this.log(agent, 'Aborted during streaming');
                            break;
                        }
                        response += chunk;
                        this.emit(agentId, chunk, 'thought');
                    }
                } catch (apiError: any) {
                    this.outputChannel.appendLine(`[AgentLoop] API Error for ${agentId}: ${apiError.message}`);
                    this.emit(agentId, `\n❌ API Error: ${apiError.message}`, 'error');
                    agent.status = 'error';
                    break;
                }

                if (agent.status !== 'running') break;

                agent.messages.push({ role: 'assistant', content: response });

                // DEBUG: Log raw response to diagnose tool call format issues (GitHub #13)
                this.outputChannel.appendLine(`\n[DEBUG] Raw LLM response for ${agentId}:`);
                this.outputChannel.appendLine(`[DEBUG] Length: ${response.length} chars`);
                this.outputChannel.appendLine(`[DEBUG] First 500 chars: ${response.substring(0, 500)}`);
                if (response.includes('```tool')) {
                    const toolMatch = response.match(/```tool\s*\n?([\s\S]*?)```/);
                    if (toolMatch) {
                        this.outputChannel.appendLine(`[DEBUG] Tool block content: ${toolMatch[1]}`);
                    }
                }
                this.outputChannel.appendLine(`[DEBUG] ---\n`);

                const toolParse = this.parseToolCalls(response);

                if (toolParse.calls.length === 0) {
                    if (response.toLowerCase().includes('task_complete') ||
                        response.toLowerCase().includes('task complete')) {
                        agent.status = 'completed';
                        this.emit(agentId, '\n\n✅ Task completed!', 'result');
                        break;
                    }

                    const currentCount = this.noToolCounts.get(agentId) || 0;
                    this.noToolCounts.set(agentId, currentCount + 1);

                    if (toolParse.invalid.length > 0) {
                        if (currentCount >= 3) {
                            this.emit(agentId, '\n\n⏹️ Agent stuck - invalid tool blocks after 3 attempts. Stopping.', 'error');
                            agent.status = 'error';
                            break;
                        }
                        agent.messages.push({
                            role: 'user',
                            content: [
                                'Your last tool block could not be parsed as JSON.',
                                '',
                                'Return ONE tool block only, shaped like:',
                                '```',
                                '{"name": "execute", "params": {"code": "YOUR_CODE_HERE"}}',
                                '```'
                            ].join('\n')
                        });
                        continue;
                    }

                    if (currentCount >= 3) {
                        this.emit(agentId, '\n\n⚠️ Agent stuck - no valid tool calls after 3 attempts. Stopping.', 'error');
                        agent.status = 'error';
                        break;
                    }

                    agent.messages.push({
                        role: 'user',
                        content: [
                            'STOP! Your response did not contain a valid tool call.',
                            '',
                            'DO NOT explain what you will do. JUST OUTPUT THE TOOL BLOCK directly.',
                            '',
                            'FORMAT:',
                            '```',
                            '{"name": "execute", "params": {"code": "YOUR_CODE_HERE"}}',
                            '```',
                            '',
                            'OUTPUT A TOOL BLOCK NOW - nothing else!'
                        ].join('\n')
                    });
                    continue;
                }

                // Reset no-tool counter on successful tool use
                this.noToolCounts.set(agentId, 0);

                const call = toolParse.calls[0];
                this.log(agent, `Executing tool: ${call.name}`);
                this.emit(agentId, `\n\n🔧 ${call.name}`, 'tool');

                // Fire toolStart event for UI
                this._onToolStart.fire({ tool: call.name, params: call.params });
                const toolStartTime = Date.now();

                const result = await this.executeTool(call.name, call.params);
                this.log(agent, `Tool result: success=${result.success}`);
                agent.toolHistory.push({ tool: call.name, params: call.params, result });

                // Record tool execution for loop detection
                this.loopDetector.recordToolExecution(agentId, {
                    name: call.name,
                    params: call.params,
                    result,
                    timestamp: Date.now()
                });

                const output = result.success
                    ? result.output.substring(0, 50000)
                    : `Error: ${result.error}`;

                // Fire toolComplete event for UI
                this._onToolComplete.fire({
                    tool: call.name,
                    success: result.success,
                    output: output.substring(0, 2000),
                    duration: Date.now() - toolStartTime
                });

                this.emit(agentId, `\n📋 ${output}`, 'result');

                // Lessons system
                let lessonsHint = '';
                if (!result.success && result.error) {
                    // Record error for loop detection
                    this.loopDetector.recordError(agentId, result.error);

                    this.pendingErrors.set(agentId, {
                        error: result.error,
                        context: `${call.name}: ${JSON.stringify(call.params)}`,
                        timestamp: Date.now()
                    });
                    const relevantLessons = this.lessons.findRelevant(result.error);
                    if (relevantLessons.length > 0) {
                        lessonsHint = this.lessons.formatForPrompt(relevantLessons);
                        this.emit(agentId, `\n💡 Found ${relevantLessons.length} relevant fix(es)`, 'result');
                    }
                } else if (result.success) {
                    const pending = this.pendingErrors.get(agentId);
                    if (pending && Date.now() - pending.timestamp < 120000) {
                        const fixDesc = this.describeFix(call.name, call.params);
                        this.lessons.recordFix(pending.error, pending.context, `${call.name}`, fixDesc);
                        this.emit(agentId, `\n📚 Learned: "${fixDesc}"`, 'result');
                        this.pendingErrors.delete(agentId);
                    }
                }

                // Check for loops - intelligent detection
                const loopCheck = this.loopDetector.detectLoop(agentId);
                if (loopCheck.isStuck) {
                    this.emit(agentId, '\n\n🔄 Loop detected!', 'error');
                    this.emit(agentId, `\nReason: ${loopCheck.reason}`, 'error');
                    if (loopCheck.evidence) {
                        loopCheck.evidence.forEach(e => this.emit(agentId, `\n  - ${e}`, 'error'));
                    }
                    this.emit(agentId, `\n💡 ${loopCheck.suggestion}`, 'error');
                    this.emit(agentId, '\n\n📤 Handing back to orchestrator for new approach...', 'tool');

                    // Fire stuck event for orchestrator
                    this._onAgentStuck.fire({
                        agentId,
                        agent,
                        reason: loopCheck.reason!,
                        evidence: loopCheck.evidence || [],
                        suggestion: loopCheck.suggestion!
                    });

                    agent.status = 'error';
                    break;
                }

                if (call.name === 'task_complete') {
                    agent.status = 'completed';
                    break;
                }

                if (call.name === 'ask_user') {
                    agent.status = 'waiting_user';
                    this._onAgentUpdate.fire(agent);
                    this.emit(agentId, '\n\n⏸️ Waiting for your response...', 'tool');
                    break;
                }

                agent.messages.push({
                    role: 'user',
                    content: `Result of ${call.name}:\n${output}${lessonsHint}\n\nNext action?`
                });
            }

            if (agent.iterations >= maxIter && agent.status === 'running') {
                this.emit(agentId, '\n\n⚠️ Max iterations reached', 'error');
                agent.status = 'error';
            }

        } catch (error: any) {
            this.emit(agentId, `\n\n❌ Error: ${error.message}`, 'error');
            agent.status = 'error';
        } finally {
            // RACE CONDITION FIX: Always clear the active loop flag
            this.activeLoops.delete(agentId);
        }

        agent.endTime = new Date();
        this._onAgentUpdate.fire(agent);
        this._onAgentComplete.fire({ agentId, status: agent.status, agent });
    }


    private fixJson(json: string): string {
        let fixed = json.trim();
        const extraBraceMatch = fixed.match(/^(\{[\s\S]*\})\}+["\s]*$/);
        if (extraBraceMatch) fixed = extraBraceMatch[1];
        fixed = fixed.replace(/'\)\}*"\}*$/, "')\"}");
        const openBraces = (fixed.match(/\{/g) || []).length;
        const closeBraces = (fixed.match(/\}/g) || []).length;
        if (openBraces > closeBraces) {
            fixed += '}'.repeat(openBraces - closeBraces);
        }
        return fixed;
    }

    private parseToolCalls(response: string): { calls: Array<{ name: string; params: Record<string, any> }>; invalid: string[] } {
        const calls: Array<{ name: string; params: Record<string, any> }> = [];
        const invalid: string[] = [];
        const toolBlockRegex = /```tool\s*\n?([\s\S]*?)```/g;
        let match;

        while ((match = toolBlockRegex.exec(response)) !== null) {
            const json = match[1].trim();
            const parsed = this.safeParseToolBlock(json);
            if (parsed) {
                calls.push(parsed);
            } else {
                invalid.push(json.slice(0, 200));
            }
        }

        return { calls, invalid };
    }

    private safeParseToolBlock(raw: string): { name: string; params: Record<string, any> } | null {
        const attempts = [raw, this.fixJson(raw)];
        for (let i = 0; i < attempts.length; i++) {
            const attempt = attempts[i];
            try {
                const parsed = JSON.parse(attempt);
                if (parsed && parsed.name && typeof parsed.name === 'string') {
                    const { name, params, ...rest } = parsed;
                    return { name, params: params || rest || {} };
                } else {
                    this.outputChannel.appendLine(`[DEBUG] Parse attempt ${i + 1} succeeded but missing 'name' field`);
                }
            } catch (error: any) {
                this.outputChannel.appendLine(`[DEBUG] Parse attempt ${i + 1} failed: ${error.message}`);
                this.outputChannel.appendLine(`[DEBUG] Attempted to parse: ${attempt.substring(0, 200)}`);
            }
        }

        // Fallback: try to extract name and code manually
        this.outputChannel.appendLine(`[DEBUG] All JSON parse attempts failed, trying regex extraction`);
        const nameMatch = raw.match(/"name"\s*:\s*"([^"]+)"/);
        const codeMatch = raw.match(/"code"\s*:\s*"([\s\S]+?)(?:"\s*\}|"$)/);
        if (nameMatch) {
            const params = codeMatch ? { code: codeMatch[1] } : {};
            return { name: nameMatch[1], params };
        }

        return null;
    }

    private async executeTool(name: string, params: Record<string, any>): Promise<ToolResult> {
        try {
            // Handle special commands
            if (name === 'task_complete') {
                return { success: true, output: params.summary || 'Task completed' };
            }

            if (name === 'ask_user') {
                return { success: true, output: `Question: ${params.question}` };
            }

            // All other tools go through MCP router (including local tools)
            if (!this.mcpInitialized || !this.mcpRouter) {
                return {
                    success: false,
                    output: '',
                    error: 'MCP not initialized. Tools are not available.'
                };
            }

            return await this.mcpRouter.callTool(name, params);
        } catch (err: any) {
            return { success: false, output: '', error: err.message };
        }
    }

    private describeFix(toolName: string, params: any): string {
        if (toolName === 'execute' && params.code) {
            if (params.code.includes('fs.write')) return 'File edit';
            if (params.code.includes('shell.run')) return 'Shell command';
            if (params.code.includes('test.')) return 'Test execution';
        }
        return `${toolName} call`;
    }


    /**
     * Continue a paused agent with user input
     *
     * @param agentId - The agent's unique ID
     * @param userResponse - The user's response to the agent's question
     *
     * @remarks
     * Agents can pause execution using the `ask_user` tool when they need input.
     * This method resumes the agent's loop with the provided response.
     *
     * Only works for agents in `waiting_user` status.
     *
     * @example
     * ```typescript
     * manager.onAgentOutput(({ agentId, content, type }) => {
     *   if (content.includes('⏸️ Waiting for your response')) {
     *     // Agent is waiting for input
     *     manager.continueAgent(agentId, 'Yes, proceed with the changes');
     *   }
     * });
     * ```
     */
    async continueAgent(agentId: string, userResponse: string): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent || agent.status !== 'waiting_user') return;

        agent.messages.push({ role: 'user', content: userResponse });
        agent.status = 'running';
        this._onAgentUpdate.fire(agent);

        this.runAgentLoop(agentId).catch(err => {
            this.outputChannel.appendLine(`[AgentManager] FATAL: Continued agent loop crashed: ${err.message}`);
            const failedAgent = this.agents.get(agentId);
            if (failedAgent) {
                failedAgent.status = 'error';
                failedAgent.endTime = new Date();
                this._onAgentUpdate.fire(failedAgent);
                this._onAgentComplete.fire({ agentId, status: 'error', agent: failedAgent });
            }
        });
    }

    /**
     * Stop a running agent gracefully
     *
     * @param agentId - The agent's unique ID
     *
     * @remarks
     * Sets the agent's status to 'stopped' and aborts its execution loop.
     * The agent will finish its current iteration before stopping.
     */
    stopAgent(agentId: string): void {
        const agent = this.agents.get(agentId);
        if (agent) {
            agent.abortController?.abort();
            agent.status = 'stopped';
            this._onAgentUpdate.fire(agent);
        }
    }

    /**
     * Kill an agent immediately (alias for stopAgent)
     *
     * @param agentId - The agent's unique ID
     */
    killAgent(agentId: string): void {
        this.stopAgent(agentId);
    }

    stopAllAgents(): void {
        for (const agent of this.agents.values()) {
            if (agent.status === 'running') {
                agent.abortController?.abort();
                agent.status = 'stopped';
            }
        }
    }

    private emit(agentId: string, content: string, type: 'thought' | 'tool' | 'result' | 'error'): void {
        this._onAgentOutput.fire({ agentId, content, type });
    }

    private log(agent: Agent, msg: string): void {
        this.outputChannel.appendLine(`[${agent.name}] ${msg}`);
    }

    /**
     * Get an agent by ID
     *
     * @param id - The agent's unique ID
     * @returns The agent instance, or undefined if not found
     */
    public getAgent(id: string): Agent | undefined { return this.agents.get(id); }

    /**
     * Get all agents (running, completed, stopped, etc.)
     *
     * @returns Array of all agent instances
     */
    public getAllAgents(): Agent[] { return Array.from(this.agents.values()); }

    /**
     * Get only agents currently running
     *
     * @returns Array of agents with status 'running'
     */
    public getRunningAgents(): Agent[] { return this.getAllAgents().filter(a => a.status === 'running'); }
    public removeAgent(id: string): void {
        // Remove agent from unified view
        this.unifiedView.removeAgent(id);

        // Clear loop detection history
        this.loopDetector.clearAgent(id);
        // Clean up other maps
        this.noToolCounts.delete(id);
        this.pendingErrors.delete(id);
        this.agentMemories.delete(id);
        // Then remove agent
        this.agents.delete(id);
    }
    public getAllArtifacts(): Artifact[] { return this.getAllAgents().flatMap(a => a.artifacts); }

    public showOutput(): void {
        this.outputChannel.show(true);
    }

    /**
     * Test the LLM provider connection
     *
     * @returns True if provider is accessible and responding, false otherwise
     *
     * @remarks
     * For Ollama: Checks /api/tags endpoint
     * For HuggingFace: Sends minimal test request with the default model
     */
    public async testConnection(): Promise<boolean> {
        if (!this.llmProvider) return false;

        if (this.providerType === 'ollama') {
            // For Ollama, use healthCheck
            return await (this.llmProvider as OllamaProvider).healthCheck();
        } else {
            // For HuggingFace, use testConnection if it exists
            const hfProvider = this.llmProvider as HuggingFaceProvider;
            return hfProvider.testConnection ? await hfProvider.testConnection(this.defaultModel) : true;
        }
    }

    public on(event: string, cb: (...args: any[]) => void): vscode.Disposable {
        if (event === 'agentUpdate' || event === 'agentSpawned' || event === 'statusChange') {
            return this._onAgentUpdate.event(cb);
        }
        if (event === 'agentOutput' || event === 'output') {
            return this._onAgentOutput.event(cb as any);
        }
        if (event === 'newArtifact') {
            const lastArtifactCount = new Map<string, number>();
            return this._onAgentUpdate.event((agent) => {
                const prevCount = lastArtifactCount.get(agent.id) || 0;
                if (agent.artifacts.length > prevCount) {
                    for (let i = prevCount; i < agent.artifacts.length; i++) {
                        cb(agent.artifacts[i]);
                    }
                    lastArtifactCount.set(agent.id, agent.artifacts.length);
                }
            });
        }
        return { dispose: () => {} };
    }

    /**
     * Clean up resources and stop all agents
     *
     * @remarks
     * Called when the extension is deactivated. Stops all running agents,
     * disposes event emitters, and disconnects from MCP servers.
     */
    public dispose(): void {
        this.stopAllAgents();
        this.activeLoops.clear();  // Clear race condition tracker
        this._onAgentUpdate.dispose();
        this._onAgentOutput.dispose();
        this._onAgentComplete.dispose();
        this._onToolStart.dispose();
        this._onToolComplete.dispose();
        this.outputChannel.dispose();
        disposeMcpRouter();
        disposeMcpOutputChannel();
    }
}
