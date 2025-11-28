import * as vscode from 'vscode';
import { HuggingFaceProvider, HFMessage, CODING_MODELS, ModelKey } from './hfProvider';
import { TOOLS, ToolResult, VSCODE_TOOLS } from './tools';
import { BROWSER_TOOLS } from './tools/browser';
import { GIT_TOOLS } from './tools/git';
import { LessonsManager, Lesson } from './tools/lessons';
import { Artifact } from './agentCommunication';
import { getMcpRouter, McpRouter, disposeMcpRouter } from './mcp';
import { UnifiedExecutor, getUnifiedToolDescription } from './mcp/unified-executor';

export type AgentType = 'frontend' | 'backend' | 'testing' | 'browser' | 'general' | 'cleaner';
export type AgentStatus = 'idle' | 'running' | 'waiting_user' | 'completed' | 'error' | 'stopped';

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
}

const AGENT_EMOJIS: Record<AgentType, string> = {
    frontend: '🎨',
    backend: '⚙️',
    testing: '🧪',
    browser: '🌐',
    general: '🔧',
    cleaner: '🧹'
};

const MAX_ITERATIONS = 100;

function getSystemPrompt(type: AgentType, mcpTools?: string): string {
    const executeToolSection = mcpTools || '';

    const typeInstructions: Record<AgentType, string> = {
        frontend: `You are a Frontend Agent. Use the execute() tool for ALL operations.

EXAMPLES:
\`\`\`tool
{"name": "execute", "params": {"code": "return fs.list('src', {recursive: true}).filter(f => f.endsWith('.tsx'))"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "const content = fs.read('src/App.tsx'); return content.substring(0, 500)"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "fs.write('src/components/Button.tsx', 'export const Button = () => <button>Click</button>')"}}
\`\`\``,

        backend: `You are a Backend Agent. Use the execute() tool for ALL operations.

EXAMPLES:
\`\`\`tool
{"name": "execute", "params": {"code": "return fs.list('backend', {recursive: true}).filter(f => f.endsWith('.py'))"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "return shell.run('python -m pytest backend/tests/ -v --tb=short')"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "const content = fs.read('backend/app.py'); return content"}}
\`\`\``,

        testing: `You are a Testing Agent. Use the execute() tool for ALL operations.

WORKFLOW:
1. Discover tests first: test.discover() to list available tests (fast)
2. Run tests one file at a time: test.runFile(path) for faster feedback
3. Check for errors: vscode.getProblems() for syntax/type errors
4. Read failing files: fs.read(path)
5. Fix issues: fs.write(path, newContent)
6. Re-run the specific test to verify: test.runFile(path)

EXAMPLES:
\`\`\`tool
{"name": "execute", "params": {"code": "return test.discover('backend/tests')"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "return test.runFile('backend/tests/test_api.py')"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "return test.run('test_login')"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "return vscode.getProblems().filter(p => p.severity === 'Error')"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "const content = fs.read('src/utils.ts'); return content"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "const old = fs.read('file.ts'); const fixed = old.replace('bug', 'fix'); fs.write('file.ts', fixed); return 'Fixed'"}}
\`\`\`

RULES:
- Fix source code, not tests (unless the test is wrong)
- Ignore security warnings in test files if they're fake credentials`,

        browser: `You are a Browser Agent. Use the execute() tool for ALL operations.

EXAMPLES:
\`\`\`tool
{"name": "execute", "params": {"code": "await browser.navigate('http://localhost:3000'); return 'Navigated'"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "return await browser.getElements('button')"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "await browser.click('#submit'); return 'Clicked'"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "await browser.type('#email', 'test@example.com'); return 'Typed'"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "return await browser.screenshot('screenshot.png')"}}
\`\`\``,

        general: `You are a General Agent. Use the execute() tool for ALL operations.

EXAMPLES:
\`\`\`tool
{"name": "execute", "params": {"code": "return fs.list('.', {recursive: true})"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "return git.status()"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "return shell.run('npm install')"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "const pkg = JSON.parse(fs.read('package.json')); return pkg.dependencies"}}
\`\`\``,

        cleaner: `You are a Cleaner Agent. Use the execute() tool for ALL operations.

Your job is to clean up code, remove unused imports, fix formatting, etc.

EXAMPLES:
\`\`\`tool
{"name": "execute", "params": {"code": "return fs.list('src', {recursive: true}).filter(f => f.endsWith('.ts'))"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "return shell.run('npx eslint src --fix')"}}
\`\`\`
\`\`\`tool
{"name": "execute", "params": {"code": "return shell.run('npx prettier --write src')"}}
\`\`\``
    };

    return `${typeInstructions[type]}

${executeToolSection}

# Tool Format
Always use this EXACT format for tool calls:
\`\`\`tool
{"name": "execute", "params": {"code": "YOUR_CODE_HERE"}}
\`\`\`

OR for task completion:
\`\`\`tool
{"name": "task_complete", "params": {"summary": "What you accomplished"}}
\`\`\`

OR to ask the user a question:
\`\`\`tool
{"name": "ask_user", "params": {"question": "Your question here"}}
\`\`\`

IMPORTANT: Use \`return\` to get results back. Scripts handle data - return only what's needed.`;
}

export class AutonomousAgentManager {
    private hfProvider: HuggingFaceProvider | null = null;
    private mcpRouter: McpRouter | null = null;
    private mcpInitialized = false;
    private agents: Map<string, Agent> = new Map();
    private outputChannel: vscode.OutputChannel;
    private defaultModel: string = 'deepseek';
    private unifiedExecutor: UnifiedExecutor;
    private lessons: LessonsManager;
    private pendingErrors: Map<string, { error: string; context: string; timestamp: number }> = new Map();

    private readonly _onAgentUpdate = new vscode.EventEmitter<Agent>();
    public readonly onAgentUpdate = this._onAgentUpdate.event;
    private readonly _onAgentOutput = new vscode.EventEmitter<{ agentId: string; content: string; type: 'thought' | 'tool' | 'result' | 'error' }>();
    public readonly onAgentOutput = this._onAgentOutput.event;

    private workspaceRoot: string;

    constructor(context: vscode.ExtensionContext) {
        // Get workspace root from VS Code
        const workspaceFolders = vscode.workspace.workspaceFolders;
        this.workspaceRoot = workspaceFolders?.[0]?.uri.fsPath || process.cwd();

        this.outputChannel = vscode.window.createOutputChannel('Liftoff Agents');
        this.unifiedExecutor = new UnifiedExecutor(this.workspaceRoot);
        this.lessons = new LessonsManager(this.workspaceRoot);
    }

    setApiKey(apiKey: string): void {
        this.hfProvider = new HuggingFaceProvider(apiKey);
        this.outputChannel.appendLine('[AgentManager] API key set');

        // Initialize MCP Router (async)
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
            } else {
                this.outputChannel.appendLine('[AgentManager] No MCP servers configured');
            }
        } catch (err: any) {
            this.outputChannel.appendLine(`[AgentManager] MCP init failed (using fallback): ${err.message}`);
        }
    }

    setModel(model: string): void {
        this.defaultModel = model;
        this.outputChannel.appendLine(`[AgentManager] Default model set to: ${model}`);
    }

    async spawnAgent(options: { type: AgentType; task: string; model?: string }): Promise<Agent> {
        const { type, task, model } = options;
        const id = `agent-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        const actualModel = model || this.defaultModel;

        const mcpTools = getUnifiedToolDescription();
        const systemPrompt = getSystemPrompt(type, mcpTools);

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
            abortController: new AbortController()
        };

        this.agents.set(id, agent);
        this._onAgentUpdate.fire(agent);
        this.outputChannel.appendLine(`[AgentManager] Spawned ${agent.name} with task: ${task}`);

        this.runAgentLoop(id);

        return agent;
    }

    private async runAgentLoop(agentId: string): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent || !this.hfProvider) return;

        agent.status = 'running';
        this._onAgentUpdate.fire(agent);

        try {
            while (agent.iterations < MAX_ITERATIONS && agent.status === 'running') {
                if (agent.abortController?.signal.aborted) {
                    agent.status = 'stopped';
                    this.emit(agentId, '\n🛑 Agent stopped by user', 'error');
                    break;
                }

                agent.iterations++;
                this.log(agent, `--- Iteration ${agent.iterations} ---`);
                console.log(`[AgentLoop] Starting iteration ${agent.iterations}, status: ${agent.status}, messages: ${agent.messages.length}`);

                let response = '';
                this.emit(agentId, '\n\n💭 ', 'thought');

                try {
                    console.log(`[AgentLoop] Calling HF API with model: ${agent.model}`);
                    for await (const chunk of this.hfProvider.streamChat(
                        agent.model,
                        agent.messages,
                        { maxTokens: 2048, temperature: 0.2 }
                    )) {
                        if (agent.abortController?.signal.aborted) {
                            console.log('[AgentLoop] Aborted during streaming');
                            break;
                        }
                        response += chunk;
                        this.emit(agentId, chunk, 'thought');
                    }
                    console.log(`[AgentLoop] API response received, length: ${response.length}`);
                } catch (apiError: any) {
                    console.error('[AgentLoop] API Error:', apiError);
                    this.emit(agentId, `\n❌ API Error: ${apiError.message}`, 'error');
                    agent.status = 'error';
                    break;
                }

                if (agent.status !== 'running') break;

                agent.messages.push({ role: 'assistant', content: response });

                const toolCalls = this.parseToolCalls(response);

                if (toolCalls.length === 0) {
                    if (response.toLowerCase().includes('task_complete') ||
                        response.toLowerCase().includes('task complete')) {
                        agent.status = 'completed';
                        this.emit(agentId, '\n\n✅ Task completed!', 'result');
                        break;
                    }

                    const noToolKey = `${agentId}_no_tool_count`;
                    const currentCount = (this as any)[noToolKey] || 0;
                    (this as any)[noToolKey] = currentCount + 1;

                    const lowerResponse = response.toLowerCase();
                    const isStuck = lowerResponse.includes('let me') ||
                                   lowerResponse.includes('i will') ||
                                   lowerResponse.includes('i need to') ||
                                   (lowerResponse.includes('fix') && !lowerResponse.includes('```'));

                    if (isStuck) {
                        this.emit(agentId, '\n⚠️ Model confused - forcing tool use', 'error');
                    }

                    if (currentCount >= 3) {
                        this.emit(agentId, '\n\n⚠️ Agent stuck - no valid tool calls after 3 attempts. Stopping.', 'error');
                        this.emit(agentId, '\n\nLast response did not contain a valid tool block. Expected format:\n```tool\n{"name": "tool_name", "params": {...}}\n```', 'error');
                        agent.status = 'error';
                        break;
                    }

                    agent.messages.push({
                        role: 'user',
                        content: `STOP! Your response did not contain a valid tool call.

DO NOT explain what you will do. DO NOT say "I will" or "Let me".
JUST OUTPUT THE TOOL BLOCK directly.

FORMAT (copy this exactly):
\`\`\`tool
{"name": "execute", "params": {"code": "YOUR_CODE_HERE"}}
\`\`\`

EXAMPLES:
- Get errors: {"name": "execute", "params": {"code": "return vscode.getProblems().filter(p => p.severity === 'Error')"}}
- Read file: {"name": "execute", "params": {"code": "return fs.read('path/to/file.ts')"}}
- Run tests: {"name": "execute", "params": {"code": "return test.runFile('backend/tests/test_api.py')"}}
- Write file: {"name": "execute", "params": {"code": "fs.write('path/to/file.ts', newContent); return 'Done'"}}
- Done: {"name": "task_complete", "params": {"summary": "What I did"}}

OUTPUT A TOOL BLOCK NOW - nothing else!`
                    });
                    continue;
                }

                (this as any)[`${agentId}_no_tool_count`] = 0;

                const call = toolCalls[0];
                console.log(`[AgentLoop] Executing tool: ${call.name}`, call.params);
                this.emit(agentId, `\n\n🔧 ${call.name}`, 'tool');

                const result = await this.executeTool(call.name, call.params, agent.type);
                console.log(`[AgentLoop] Tool result: success=${result.success}, output length=${result.output?.length || 0}`);
                agent.toolHistory.push({ tool: call.name, params: call.params, result });

                const output = result.success
                    ? result.output.substring(0, 50000)
                    : `Error: ${result.error}`;

                this.emit(agentId, `\n📋 ${output}`, 'result');
                console.log(`[AgentLoop] Emitted result, continuing to next iteration...`);

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
                        this.emit(agentId, `\n💡 Found ${relevantLessons.length} relevant fix(es) from past experience`, 'result');
                    }
                } else if (result.success) {
                    const pending = this.pendingErrors.get(agentId);
                    if (pending && Date.now() - pending.timestamp < 120000) {
                        const fixDesc = this.describeFix(call.name, call.params);
                        this.lessons.recordFix(
                            pending.error,
                            pending.context,
                            `${call.name}: ${JSON.stringify(call.params)}`,
                            fixDesc
                        );
                        this.emit(agentId, `\n📚 Learned: "${fixDesc}" fixes "${pending.error.substring(0, 50)}..."`, 'result');
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

                let nextHint = 'Next action?';
                if (call.name === 'run_command') {
                    if (output.includes('Port') && output.includes('in use') || output.includes('still in use')) {
                        nextHint = 'APP IS ALREADY RUNNING! Do NOT start again. Use browser_navigate to http://localhost:5176 now.';
                    } else if (output.includes('started successfully') || output.includes('SUCCESS')) {
                        nextHint = 'App started! Wait 5 seconds for frontend to be ready, then use browser_navigate to http://localhost:5176.';
                    }
                } else if (call.name === 'browser_navigate') {
                    if (output.includes('Failed') || output.includes('error')) {
                        nextHint = 'Navigation failed. Use browser_wait for 5 seconds, then try browser_navigate again.';
                    } else {
                        nextHint = 'Page loaded. Use browser_get_elements to see what you can interact with.';
                    }
                } else if (call.name === 'browser_get_elements') {
                    if (output.includes('No interactive elements')) {
                        nextHint = 'No elements found - page may still be loading. Use browser_wait for 3 seconds, then browser_get_elements again.';
                    } else {
                        nextHint = 'Now use browser_click or browser_type with the selectors shown above. ONE action at a time!';
                    }
                } else if (call.name === 'browser_click' || call.name === 'browser_type') {
                    nextHint = 'Action done. Use browser_get_elements or browser_get_text to see the result.';
                } else if (call.name === 'browser_wait') {
                    nextHint = 'Wait complete. Now proceed with your next action.';
                }

                agent.messages.push({
                    role: 'user',
                    content: `Result of ${call.name}:\n${output}${lessonsHint}\n\n${nextHint}`
                });
            }

            if (agent.iterations >= MAX_ITERATIONS && agent.status === 'running') {
                this.emit(agentId, '\n\n⚠️ Max iterations reached', 'error');
                agent.status = 'error';
            }

        } catch (error: any) {
            this.emit(agentId, `\n\n❌ Error: ${error.message}`, 'error');
            agent.status = 'error';
        }

        agent.endTime = new Date();
        this._onAgentUpdate.fire(agent);
    }

    private parseToolCalls(response: string): Array<{ name: string; params: Record<string, any> }> {
        const calls: Array<{ name: string; params: Record<string, any> }> = [];

        const toolBlockRegex = /```tool\s*\n?([\s\S]*?)```/g;
        let match;

        while ((match = toolBlockRegex.exec(response)) !== null) {
            try {
                const json = match[1].trim();
                const parsed = JSON.parse(json);
                if (parsed.name && typeof parsed.name === 'string') {
                    const { name, params, ...rest } = parsed;
                    const extractedParams = params || (Object.keys(rest).length > 0 ? rest : {});

                    this.outputChannel.appendLine(`[parseToolCalls] Extracted tool: ${name}, params: ${JSON.stringify(extractedParams)}`);

                    calls.push({
                        name: name,
                        params: extractedParams
                    });
                    break;
                }
            } catch (e) {
                this.outputChannel.appendLine(`Failed to parse: ${match[1]}`);
            }
        }

        return calls;
    }

    private async executeTool(name: string, params: Record<string, any>, agentType: AgentType): Promise<ToolResult> {
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

            const allTools = [
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

        this.runAgentLoop(agentId);
    }

    stopAgent(agentId: string): void {
        const agent = this.agents.get(agentId);
        if (agent) {
            agent.abortController?.abort();
            agent.status = 'stopped';
            this._onAgentUpdate.fire(agent);
        }
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
        console.log('[AgentManager] emit:', type, agentId, content.substring(0, 50));
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
        return { dispose: () => {} };
    }

    public dispose(): void {
        this.stopAllAgents();
        this.outputChannel.dispose();
        disposeMcpRouter();
        this.unifiedExecutor.dispose();
    }
}
