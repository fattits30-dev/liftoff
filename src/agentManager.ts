import * as vscode from 'vscode';
import { HuggingFaceProvider, HFMessage, CODING_MODELS, ModelKey } from './hfProvider';
import { AgentCommunication, AgentMessage, Artifact } from './agentCommunication';

export type AgentType = 'frontend' | 'backend' | 'testing' | 'browser' | 'general' | 'cleaner';
export type AgentStatus = 'idle' | 'running' | 'completed' | 'error';

export interface Agent {
    id: string;
    type: AgentType;
    status: AgentStatus;
    name: string;
    task: string;
    messages: HFMessage[];
    artifacts: Artifact[];
    startTime: Date;
    endTime?: Date;
    cost: number;
}

export interface AgentConfig {
    type: AgentType;
    task: string;
    model?: ModelKey;
}

const AGENT_EMOJIS: Record<AgentType, string> = {
    frontend: '🎨',
    backend: '⚙️',
    testing: '🧪',
    browser: '🌐',
    general: '🔧',
    cleaner: '🧹'
};

const AGENT_SYSTEM_PROMPTS: Record<AgentType, string> = {
    frontend: `You are a Frontend Development Agent specialized in React, Vue, Angular, CSS, HTML, and modern UI/UX.
Your capabilities:
- Create and modify React/Vue/Angular components
- Write CSS/SCSS/Tailwind styles
- Implement responsive designs
- Handle state management (Redux, Zustand, Pinia)
- Write TypeScript for frontend applications

When you need backend work done, output: HANDOFF:backend:<task description>
When you find bugs, output: BUG:<agent-type>:<issue description>
Always provide complete, working code.`,

    backend: `You are a Backend Development Agent specialized in Node.js, Python, APIs, and databases.
Your capabilities:
- Create REST and GraphQL APIs
- Write Node.js/Express/FastAPI/Django code
- Design database schemas (PostgreSQL, MongoDB)
- Implement authentication and authorization
- Handle file processing and background jobs

When you need frontend work done, output: HANDOFF:frontend:<task description>
When you need tests, output: HANDOFF:testing:<task description>
Always provide complete, working code.`,

    testing: `You are a Testing Agent specialized in automated testing and quality assurance.
Your capabilities:
- Write unit tests (Jest, Vitest, pytest)
- Create integration tests
- Design E2E tests (Playwright, Cypress)
- Implement test fixtures and mocks
- Generate test coverage reports

Report bugs you find: BUG:<agent-type>:<issue description>
Always provide complete, runnable test code.`,

    browser: `You are a Browser Automation Agent specialized in web scraping and browser testing.
Your capabilities:
- Automate browser interactions with Playwright
- Capture screenshots and generate reports
- Test responsive layouts across viewports
- Extract data from web pages
- Monitor visual regressions

Always provide complete Playwright scripts.`,

    general: `You are a General Development Agent capable of handling various programming tasks.
Your capabilities:
- Code review and refactoring
- Documentation writing
- DevOps and CI/CD configuration
- General problem solving
- Architecture planning

Delegate specialized work:
- HANDOFF:frontend:<task> for UI work
- HANDOFF:backend:<task> for API work
- HANDOFF:testing:<task> for tests
Always provide complete, working solutions.`,

    cleaner: `You are a Project Cleaner Agent that removes broken, orphaned, and dead code.
Your capabilities:
- Find and remove broken test files (ImportError, ModuleNotFoundError)
- Clean up orphaned test helpers
- Remove stale cache files (__pycache__, .pytest_cache)
- Delete empty directories after cleanup

SAFETY RULES:
- ONLY delete files in test directories (tests/, __tests__/)
- NEVER delete source code
- Always verify a file is broken before deleting
- Commit cleanup with clear message

Run "pytest --collect-only" or "vitest --run" to find broken tests.`
};


export class AgentManager {
    private agents: Map<string, Agent> = new Map();
    private hfProvider: HuggingFaceProvider | null = null;
    private communication: AgentCommunication;
    private outputChannel: vscode.OutputChannel;
    private defaultModel: ModelKey = 'qwen-32b';
    
    private _onAgentUpdate = new vscode.EventEmitter<Agent>();
    public readonly onAgentUpdate = this._onAgentUpdate.event;
    
    private _onAgentOutput = new vscode.EventEmitter<{agentId: string, content: string}>();
    public readonly onAgentOutput = this._onAgentOutput.event;

    constructor(context: vscode.ExtensionContext) {
        this.communication = new AgentCommunication();
        this.outputChannel = vscode.window.createOutputChannel('Liftoff Agents');
        
        // Initialize HF provider with stored key
        const config = vscode.workspace.getConfiguration('liftoff');
        const apiKey = config.get<string>('huggingfaceApiKey');
        if (apiKey) {
            this.hfProvider = new HuggingFaceProvider(apiKey);
        }
        
        // Listen for inter-agent messages
        this.communication.onMessage((msg) => this.handleInterAgentMessage(msg));
    }

    public setApiKey(apiKey: string): void {
        this.hfProvider = new HuggingFaceProvider(apiKey);
        // Save to config
        vscode.workspace.getConfiguration('liftoff').update('huggingfaceApiKey', apiKey, true);
    }

    public setDefaultModel(model: ModelKey): void {
        this.defaultModel = model;
    }

    public getDefaultModel(): ModelKey {
        return this.defaultModel;
    }

    public getAvailableModels(): typeof CODING_MODELS {
        return CODING_MODELS;
    }


    public async spawnAgent(config: AgentConfig): Promise<Agent> {
        if (!this.hfProvider) {
            throw new Error('HuggingFace API key not configured. Set it in VS Code settings (liftoff.huggingfaceApiKey) or use the command palette.');
        }

        const id = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const model = config.model || this.defaultModel;
        
        const agent: Agent = {
            id,
            type: config.type,
            status: 'idle',
            name: `${AGENT_EMOJIS[config.type]} ${config.type.charAt(0).toUpperCase() + config.type.slice(1)} Agent`,
            task: config.task,
            messages: [
                { role: 'system', content: AGENT_SYSTEM_PROMPTS[config.type] },
                { role: 'user', content: config.task }
            ],
            artifacts: [],
            startTime: new Date(),
            cost: 0
        };

        this.agents.set(id, agent);
        this.outputChannel.appendLine(`[${new Date().toISOString()}] Spawned ${agent.name} (${id})`);
        this.outputChannel.appendLine(`Task: ${config.task}`);
        this.outputChannel.appendLine(`Model: ${CODING_MODELS[model]}`);
        
        this._onAgentUpdate.fire(agent);
        
        // Start the agent
        this.runAgent(id, model);
        
        return agent;
    }


    private async runAgent(agentId: string, model: ModelKey): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent || !this.hfProvider) return;

        agent.status = 'running';
        this._onAgentUpdate.fire(agent);

        try {
            const modelName = CODING_MODELS[model];
            let fullResponse = '';

            // Stream the response
            for await (const chunk of this.hfProvider.streamChat(modelName, agent.messages, {
                maxTokens: 4096,
                temperature: 0.7
            })) {
                fullResponse += chunk;
                this._onAgentOutput.fire({ agentId, content: chunk });
            }

            // Add assistant response to messages
            agent.messages.push({ role: 'assistant', content: fullResponse });

            // Extract artifacts (code blocks)
            const artifacts = this.extractArtifacts(fullResponse, agentId);
            agent.artifacts.push(...artifacts);

            // Check for handoffs
            const handoffs = this.parseHandoffs(fullResponse);
            const config = vscode.workspace.getConfiguration('liftoff');
            const autoHandoff = config.get<boolean>('autoHandoff', true);

            if (autoHandoff && handoffs.length > 0) {
                for (const handoff of handoffs) {
                    this.outputChannel.appendLine(`[Handoff] ${agent.name} -> ${handoff.targetType}: ${handoff.task}`);
                    await this.spawnAgent({
                        type: handoff.targetType,
                        task: `[From ${agent.type} agent] ${handoff.task}`,
                        model
                    });
                }
            }

            agent.status = 'completed';
            agent.endTime = new Date();
            
        } catch (error: any) {
            agent.status = 'error';
            agent.endTime = new Date();
            this.outputChannel.appendLine(`[Error] ${agent.name}: ${error.message}`);
            this._onAgentOutput.fire({ agentId, content: `\n\n❌ Error: ${error.message}` });
        }

        this._onAgentUpdate.fire(agent);
    }


    public async continueAgent(agentId: string, message: string): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new Error(`Agent ${agentId} not found`);
        }

        // Add user message
        agent.messages.push({ role: 'user', content: message });
        
        // Re-run the agent
        const config = vscode.workspace.getConfiguration('liftoff');
        const model = (config.get<string>('defaultModel') || 'qwen-32b') as ModelKey;
        await this.runAgent(agentId, model);
    }

    private extractArtifacts(content: string, agentId: string): Artifact[] {
        const artifacts: Artifact[] = [];
        const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
        let match;
        let index = 0;

        while ((match = codeBlockRegex.exec(content)) !== null) {
            const language = match[1] || 'text';
            const code = match[2].trim();
            
            artifacts.push({
                id: `artifact-${agentId}-${index++}`,
                type: 'code',
                content: code,
                language,
                timestamp: new Date(),
                agentId
            });
        }

        return artifacts;
    }

    private parseHandoffs(content: string): Array<{targetType: AgentType, task: string}> {
        const handoffs: Array<{targetType: AgentType, task: string}> = [];
        const handoffRegex = /HANDOFF:(\w+):(.+?)(?:\n|$)/g;
        let match;

        while ((match = handoffRegex.exec(content)) !== null) {
            const targetType = match[1] as AgentType;
            const task = match[2].trim();
            
            if (['frontend', 'backend', 'testing', 'browser', 'general', 'cleaner'].includes(targetType)) {
                handoffs.push({ targetType, task });
            }
        }

        return handoffs;
    }


    private handleInterAgentMessage(msg: AgentMessage): void {
        this.outputChannel.appendLine(`[Inter-Agent] ${msg.fromAgent} -> ${msg.toAgent}: ${msg.type}`);
        
        const config = vscode.workspace.getConfiguration('liftoff');
        const autoHandoff = config.get<boolean>('autoHandoff', true);
        
        if (autoHandoff && msg.type === 'handoff') {
            this.spawnAgent({
                type: msg.toAgent as AgentType,
                task: msg.content
            });
        }
    }

    public getAgent(id: string): Agent | undefined {
        return this.agents.get(id);
    }

    public getAllAgents(): Agent[] {
        return Array.from(this.agents.values());
    }

    public getRunningAgents(): Agent[] {
        return this.getAllAgents().filter(a => a.status === 'running');
    }

    public stopAllAgents(): void {
        for (const agent of this.agents.values()) {
            if (agent.status === 'running') {
                agent.status = 'error';
                agent.endTime = new Date();
                this._onAgentUpdate.fire(agent);
            }
        }
        this.outputChannel.appendLine('[Manager] All agents stopped');
    }

    public clearAgents(): void {
        this.agents.clear();
        this.outputChannel.appendLine('[Manager] All agents cleared');
    }

    public async testConnection(): Promise<boolean> {
        if (!this.hfProvider) {
            return false;
        }

        // Get the model name, handling both full names and keys
        const config = vscode.workspace.getConfiguration('liftoff');
        const configuredModel = config.get<string>('defaultModel') || 'deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct';

        // Check if it's already a full model name
        if (configuredModel.includes('/')) {
            const success = await this.hfProvider.testConnection(configuredModel);
            if (success) return true;
        } else {
            // Otherwise treat it as a model key
            const modelKey = configuredModel as ModelKey;
            const modelName = CODING_MODELS[modelKey] || configuredModel;
            const success = await this.hfProvider.testConnection(modelName);
            if (success) return true;
        }

        // Fallback: Try models known to work on free accounts
        const fallbackModels = [
            'deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct',
            'Qwen/Qwen2.5-Coder-7B-Instruct',
            'Qwen/Qwen2.5-Coder-1.5B-Instruct'
        ];

        for (const model of fallbackModels) {
            try {
                const success = await this.hfProvider.testConnection(model);
                if (success) {
                    // Update config to use working model
                    vscode.workspace.getConfiguration('liftoff').update('defaultModel', model, true);
                    return true;
                }
            } catch (e) {
                // Continue to next model
            }
        }

        return false;
    }

    // Additional methods for UI compatibility
    public killAgent(agentId: string): void {
        const agent = this.agents.get(agentId);
        if (agent && agent.status === 'running') {
            agent.status = 'error';
            agent.endTime = new Date();
            this._onAgentUpdate.fire(agent);
            this.outputChannel.appendLine(`[Manager] Killed agent ${agentId}`);
        }
    }

    public removeAgent(agentId: string): void {
        this.agents.delete(agentId);
        this.outputChannel.appendLine(`[Manager] Removed agent ${agentId}`);
    }

    public getAllArtifacts(): Artifact[] {
        const allArtifacts: Artifact[] = [];
        for (const agent of this.agents.values()) {
            allArtifacts.push(...agent.artifacts);
        }
        return allArtifacts;
    }

    // Event subscription helpers - supports multiple event name aliases
    public on(event: 'agentUpdate' | 'agentSpawned' | 'statusChange', callback: (agent: Agent) => void): vscode.Disposable;
    public on(event: 'agentOutput' | 'output', callback: (data: {agentId: string, content: string}) => void): vscode.Disposable;
    public on(event: 'newArtifact', callback: (artifact: Artifact) => void): vscode.Disposable;
    public on(event: string, callback: (...args: any[]) => void): vscode.Disposable {
        if (event === 'agentUpdate' || event === 'agentSpawned' || event === 'statusChange') {
            return this._onAgentUpdate.event(callback);
        } else if (event === 'agentOutput' || event === 'output') {
            return this._onAgentOutput.event(callback);
        } else if (event === 'newArtifact') {
            // For artifacts, we'll hook into agent updates and filter for artifacts
            return this._onAgentUpdate.event((agent) => {
                if (agent.artifacts.length > 0) {
                    const latestArtifact = agent.artifacts[agent.artifacts.length - 1];
                    callback(latestArtifact);
                }
            });
        }
        throw new Error(`Unknown event: ${event}`);
    }

    public dispose(): void {
        this.stopAllAgents();
        this.outputChannel.dispose();
        this._onAgentUpdate.dispose();
        this._onAgentOutput.dispose();
    }
}
