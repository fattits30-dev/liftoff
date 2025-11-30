import * as vscode from 'vscode';
import { HuggingFaceProvider, HFMessage } from './hfProvider';
import { TOOLS, ToolResult, VSCODE_TOOLS, Tool } from './tools';
import { BROWSER_TOOLS } from './tools/browser';
import { GIT_TOOLS } from './tools/git';
import { LessonsManager } from './tools/lessons';
import { Artifact } from './agentCommunication';
import { getMcpRouter, McpRouter, disposeMcpRouter, disposeMcpOutputChannel } from './mcp';
import { UnifiedExecutor, getUnifiedToolDescription } from './mcp/unified-executor';
import { AgentMemory, SemanticMemoryStore } from './memory/agentMemory';
import { DEFAULT_CLOUD_MODEL_NAME, LIMITS } from './config';
import { buildAgentSystemPrompt } from './config/prompts';
import { AgentType, AgentStatus } from './types/agentTypes';
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

export class AutonomousAgentManager {
    private hfProvider: HuggingFaceProvider | null = null;
    private mcpRouter: McpRouter | null = null;
    private mcpInitialized = false;
    private agents: Map<string, Agent> = new Map();
    private outputChannel: vscode.OutputChannel;
    private defaultModel: string = DEFAULT_CLOUD_MODEL_NAME;
    private unifiedExecutor: UnifiedExecutor;
    private lessons: LessonsManager;
    private pendingErrors: Map<string, { error: string; context: string; timestamp: number }> = new Map();
    
    // Track consecutive iterations without tool calls per agent
    private noToolCounts: Map<string, number> = new Map();
    
    // Prevent race conditions - track which agents have active loops
    private activeLoops: Set<string> = new Set();

    // Memory system - dedicated memory for each agent
    private semanticMemory: SemanticMemoryStore | null = null;
    private agentMemories: Map<string, AgentMemory> = new Map();

    private readonly _onAgentUpdate = new vscode.EventEmitter<Agent>();
    public readonly onAgentUpdate = this._onAgentUpdate.event;
    private readonly _onAgentOutput = new vscode.EventEmitter<{ agentId: string; content: string; type: 'thought' | 'tool' | 'result' | 'error' }>();
    public readonly onAgentOutput = this._onAgentOutput.event;

    // Event-driven completion
    private readonly _onAgentComplete = new vscode.EventEmitter<{ agentId: string; status: AgentStatus; agent: Agent }>();
    public readonly onAgentComplete = this._onAgentComplete.event;

    // Tool execution events for UI
    private readonly _onToolStart = new vscode.EventEmitter<{ tool: string; params: Record<string, unknown> }>();
    public readonly onToolStart = this._onToolStart.event;
    private readonly _onToolComplete = new vscode.EventEmitter<{ tool: string; success: boolean; output: string; duration: number }>();
    public readonly onToolComplete = this._onToolComplete.event;

    private workspaceRoot: string;

    constructor(context: vscode.ExtensionContext, semanticMemory?: SemanticMemoryStore) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        this.workspaceRoot = workspaceFolders?.[0]?.uri.fsPath || process.cwd();

        this.outputChannel = vscode.window.createOutputChannel('Liftoff Agents');
        this.unifiedExecutor = new UnifiedExecutor(this.workspaceRoot);
        this.lessons = new LessonsManager(this.workspaceRoot);

        if (semanticMemory) {
            this.semanticMemory = semanticMemory;
            this.outputChannel.appendLine('[AgentManager] Memory system initialized');
        }
    }

    setApiKey(apiKey: string): void {
        this.hfProvider = new HuggingFaceProvider(apiKey);
        this.outputChannel.appendLine('[AgentManager] API key set');
        this.initMcpRouter();
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

    async spawnAgent(options: {
        type: AgentType;
        task: string;
        model?: string;
        maxIterations?: number;
    }): Promise<Agent> {
        const { type, task, model, maxIterations } = options;
        const id = `agent-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        const actualModel = model || this.defaultModel;

        const mcpTools = getUnifiedToolDescription();
        const systemPrompt = buildAgentSystemPrompt(type, mcpTools);

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

        if (!this.hfProvider) {
            this.emit(agentId, '❌ API key not set', 'error');
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
                    for await (const chunk of this.hfProvider.streamChat(
                        agent.model,
                        agent.messages,
                        { maxTokens: 2048, temperature: 0.2 }
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
        for (const attempt of attempts) {
            try {
                const parsed = JSON.parse(attempt);
                if (parsed && parsed.name && typeof parsed.name === 'string') {
                    const { name, params, ...rest } = parsed;
                    return { name, params: params || rest || {} };
                }
            } catch {
                // fall through
            }
        }

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
            if (name === 'execute') {
                const result = await this.unifiedExecutor.execute(params.code, params.timeout);
                return {
                    success: result.success,
                    output: result.success
                        ? (typeof result.result === 'object' ? JSON.stringify(result.result, null, 2) : String(result.result ?? 'undefined'))
                        : '',
                    error: result.error
                };
            }

            if (this.mcpInitialized && this.mcpRouter) {
                const mcpResult = await this.mcpRouter.callTool(name, params);
                if (mcpResult.success || !mcpResult.error?.includes('Unknown tool')) {
                    return mcpResult;
                }
            }

            if (name === 'task_complete') {
                return { success: true, output: params.summary || 'Task completed' };
            }

            if (name === 'ask_user') {
                return { success: true, output: `Question: ${params.question}` };
            }

            const allTools: Tool[] = [
                ...Object.values(TOOLS),
                ...Object.values(VSCODE_TOOLS),
                ...Object.values(BROWSER_TOOLS),
                ...Object.values(GIT_TOOLS)
            ];
            const tool = allTools.find(t => t.name === name);
            if (tool) {
                return await tool.execute(params, this.workspaceRoot);
            }

            return { success: false, output: '', error: `Unknown tool: ${name}` };
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

    stopAgent(agentId: string): void {
        const agent = this.agents.get(agentId);
        if (agent) {
            agent.abortController?.abort();
            agent.status = 'stopped';
            this._onAgentUpdate.fire(agent);
        }
    }

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

    public getAgent(id: string): Agent | undefined { return this.agents.get(id); }
    public getAllAgents(): Agent[] { return Array.from(this.agents.values()); }
    public getRunningAgents(): Agent[] { return this.getAllAgents().filter(a => a.status === 'running'); }
    public removeAgent(id: string): void { this.agents.delete(id); }
    public getAllArtifacts(): Artifact[] { return this.getAllAgents().flatMap(a => a.artifacts); }

    public showOutput(): void {
        this.outputChannel.show(true);
    }

    public async testConnection(): Promise<boolean> {
        if (!this.hfProvider) return false;
        return this.hfProvider.testConnection(this.defaultModel);
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
        // UnifiedExecutor.dispose() is async but we're in sync context
        // Fire and forget - browser cleanup is best-effort
        this.unifiedExecutor.dispose().catch(() => {});
    }
}
