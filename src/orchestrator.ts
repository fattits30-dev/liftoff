/**
 * Orchestrator - The brain that coordinates all agents
 *
 * Cloud brain for planning, local muscle for execution.
 * Takes high-level tasks, breaks them down, delegates to specialists.
 */

import * as vscode from 'vscode';
import { AutonomousAgentManager, AgentType, Agent } from './autonomousAgent';
import { HybridRouter } from './providers/hybridRouter';
import { HuggingFaceProvider } from './hfProvider';

export interface TaskPlan {
    summary: string;
    steps: TaskStep[];
    estimatedComplexity: 'simple' | 'medium' | 'complex';
}

export interface TaskStep {
    id: number;
    description: string;
    agentType: AgentType;
    dependencies: number[]; // IDs of steps that must complete first
    task: string; // The actual task to give the agent
}

export interface OrchestratorMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    agentResults?: AgentResult[];
}

export interface AgentResult {
    agentId: string;
    agentType: AgentType;
    task: string;
    status: 'completed' | 'error' | 'stopped';
    summary: string;
}

const ORCHESTRATOR_SYSTEM_PROMPT = `You are an AI Orchestrator that coordinates specialized coding agents.

Your job is to:
1. Understand the user's high-level request
2. Break it down into specific tasks
3. Decide which agent type handles each task
4. Coordinate execution and report results

Available agent types:
- frontend: React/Vue/CSS, UI components, styling, builds
- backend: APIs, databases, server code, Python/Node
- testing: Run tests, analyze failures, fix test issues
- browser: Automated browser testing, UI interaction
- cleaner: Code cleanup, formatting, dead code removal
- general: General development tasks

When asked to plan a task, respond with a JSON plan:
\`\`\`json
{
  "summary": "Brief description of what we'll do",
  "steps": [
    {
      "id": 1,
      "description": "What this step accomplishes",
      "agentType": "testing",
      "dependencies": [],
      "task": "The specific task instruction for the agent"
    }
  ],
  "estimatedComplexity": "simple|medium|complex"
}
\`\`\`

Rules:
- Keep plans focused and minimal
- Prefer sequential steps over parallel when there are dependencies
- Be specific in task instructions
- For simple requests, a single agent is often enough
- Always include a testing step for code changes`;

export class Orchestrator {
    private agentManager: AutonomousAgentManager;
    private hfProvider: HuggingFaceProvider | null = null;
    private hybridRouter: HybridRouter | null = null;
    private messages: OrchestratorMessage[] = [];
    private outputChannel: vscode.OutputChannel;
    private activeAgents: Map<string, Agent> = new Map();

    private readonly _onMessage = new vscode.EventEmitter<OrchestratorMessage>();
    public readonly onMessage = this._onMessage.event;

    private readonly _onPlanCreated = new vscode.EventEmitter<TaskPlan>();
    public readonly onPlanCreated = this._onPlanCreated.event;

    private readonly _onAgentSpawned = new vscode.EventEmitter<{ step: TaskStep; agent: Agent }>();
    public readonly onAgentSpawned = this._onAgentSpawned.event;

    constructor(agentManager: AutonomousAgentManager) {
        this.agentManager = agentManager;
        this.outputChannel = vscode.window.createOutputChannel('Liftoff Orchestrator');

        // Add system message
        this.messages.push({
            role: 'system',
            content: ORCHESTRATOR_SYSTEM_PROMPT,
            timestamp: new Date()
        });
    }

    setApiKey(apiKey: string): void {
        this.hfProvider = new HuggingFaceProvider(apiKey);
        this.hybridRouter = new HybridRouter({
            cloudApiKey: apiKey,
            cloudModel: 'meta-llama/Llama-3.3-70B-Instruct',
            localModel: 'qwen2.5-coder:7b-instruct-q5_K_M',
        });
    }

    /**
     * Main entry point - process a user request
     */
    async chat(userMessage: string): Promise<string> {
        // Add user message
        this.messages.push({
            role: 'user',
            content: userMessage,
            timestamp: new Date()
        });
        this._onMessage.fire(this.messages[this.messages.length - 1]);

        // Determine if this needs planning or is a simple question
        const needsPlanning = this.needsPlanning(userMessage);

        if (needsPlanning) {
            return this.planAndExecute(userMessage);
        } else {
            return this.directResponse(userMessage);
        }
    }

    /**
     * Check if a message requires task planning
     */
    private needsPlanning(message: string): boolean {
        const planKeywords = [
            'build', 'create', 'implement', 'add', 'fix', 'run', 'test',
            'deploy', 'refactor', 'update', 'change', 'modify', 'delete',
            'setup', 'configure', 'install', 'make', 'write'
        ];

        const lower = message.toLowerCase();
        return planKeywords.some(kw => lower.includes(kw));
    }

    /**
     * Direct response for simple questions
     */
    private async directResponse(message: string): Promise<string> {
        if (!this.hfProvider) {
            return "Please set your API key first (Command Palette > Liftoff: Set HuggingFace API Key)";
        }

        try {
            const response = await this.hfProvider.chat(
                'meta-llama/Llama-3.3-70B-Instruct',
                this.messages.map(m => ({ role: m.role, content: m.content })),
                { maxTokens: 1024, temperature: 0.3 }
            );

            this.messages.push({
                role: 'assistant',
                content: response,
                timestamp: new Date()
            });
            this._onMessage.fire(this.messages[this.messages.length - 1]);

            return response;
        } catch (err: any) {
            return `Error: ${err.message}`;
        }
    }

    /**
     * Plan and execute a complex task
     */
    private async planAndExecute(userMessage: string): Promise<string> {
        if (!this.hfProvider) {
            return "Please set your API key first";
        }

        // Step 1: Create a plan
        this.log('Creating execution plan...');
        const plan = await this.createPlan(userMessage);

        if (!plan) {
            return "I couldn't create a plan for this task. Could you be more specific?";
        }

        this._onPlanCreated.fire(plan);

        // Announce the plan
        const planAnnouncement = this.formatPlanAnnouncement(plan);
        this.messages.push({
            role: 'assistant',
            content: planAnnouncement,
            timestamp: new Date()
        });
        this._onMessage.fire(this.messages[this.messages.length - 1]);

        // Step 2: Execute the plan
        const results = await this.executePlan(plan);

        // Step 3: Summarize results
        const summary = this.summarizeResults(plan, results);
        this.messages.push({
            role: 'assistant',
            content: summary,
            timestamp: new Date(),
            agentResults: results
        });
        this._onMessage.fire(this.messages[this.messages.length - 1]);

        return summary;
    }

    /**
     * Create an execution plan using the cloud model
     */
    private async createPlan(userMessage: string): Promise<TaskPlan | null> {
        if (!this.hfProvider) return null;

        const planPrompt = `User request: "${userMessage}"

Analyze this request and create an execution plan. Respond ONLY with the JSON plan, no other text.`;

        try {
            const response = await this.hfProvider.chat(
                'meta-llama/Llama-3.3-70B-Instruct',
                [
                    { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
                    { role: 'user', content: planPrompt }
                ],
                { maxTokens: 2048, temperature: 0.2 }
            );

            // Extract JSON from response
            const jsonMatch = response.match(/```json\s*([\s\S]*?)```/) ||
                             response.match(/\{[\s\S]*"steps"[\s\S]*\}/);

            if (jsonMatch) {
                const jsonStr = jsonMatch[1] || jsonMatch[0];
                return JSON.parse(jsonStr) as TaskPlan;
            }

            // Try parsing the whole response as JSON
            return JSON.parse(response) as TaskPlan;
        } catch (err: any) {
            this.log(`Plan parsing failed: ${err.message}`);

            // Fallback: create a simple single-agent plan
            const agentType = this.inferAgentType(userMessage);
            return {
                summary: `Execute: ${userMessage}`,
                steps: [{
                    id: 1,
                    description: userMessage,
                    agentType,
                    dependencies: [],
                    task: userMessage
                }],
                estimatedComplexity: 'simple'
            };
        }
    }

    /**
     * Infer the best agent type from a message
     */
    private inferAgentType(message: string): AgentType {
        const lower = message.toLowerCase();

        if (lower.includes('test') || lower.includes('spec') || lower.includes('coverage')) {
            return 'testing';
        }
        if (lower.includes('react') || lower.includes('vue') || lower.includes('css') ||
            lower.includes('component') || lower.includes('ui') || lower.includes('frontend')) {
            return 'frontend';
        }
        if (lower.includes('api') || lower.includes('database') || lower.includes('server') ||
            lower.includes('backend') || lower.includes('python') || lower.includes('endpoint')) {
            return 'backend';
        }
        if (lower.includes('browser') || lower.includes('click') || lower.includes('navigate')) {
            return 'browser';
        }
        if (lower.includes('clean') || lower.includes('format') || lower.includes('lint') ||
            lower.includes('unused') || lower.includes('dead code')) {
            return 'cleaner';
        }

        return 'general';
    }

    /**
     * Execute a plan by spawning agents
     */
    private async executePlan(plan: TaskPlan): Promise<AgentResult[]> {
        const results: AgentResult[] = [];
        const completedSteps = new Set<number>();

        // Sort steps by dependencies (topological sort)
        const sortedSteps = this.topologicalSort(plan.steps);

        for (const step of sortedSteps) {
            // Wait for dependencies
            while (!step.dependencies.every(d => completedSteps.has(d))) {
                await this.sleep(500);
            }

            this.log(`Executing step ${step.id}: ${step.description}`);

            // Spawn agent for this step
            const agent = await this.agentManager.spawnAgent({
                type: step.agentType,
                task: step.task,
                executionMode: this.shouldUseLocal(step) ? 'local' : 'cloud'
            });

            this.activeAgents.set(agent.id, agent);
            this._onAgentSpawned.fire({ step, agent });

            // Wait for agent to complete
            const result = await this.waitForAgent(agent.id);
            results.push({
                agentId: agent.id,
                agentType: step.agentType,
                task: step.task,
                status: result.status as 'completed' | 'error' | 'stopped',
                summary: this.extractAgentSummary(result)
            });

            completedSteps.add(step.id);
            this.activeAgents.delete(agent.id);

            // If a step failed and it's critical, stop execution
            if (result.status === 'error' && plan.estimatedComplexity !== 'simple') {
                this.log(`Step ${step.id} failed, stopping execution`);
                break;
            }
        }

        return results;
    }

    /**
     * Decide if a step should use local execution
     */
    private shouldUseLocal(step: TaskStep): boolean {
        // Heavy code generation tasks -> local
        const heavyTasks = ['implement', 'create', 'write', 'refactor', 'build'];
        const isHeavy = heavyTasks.some(t => step.task.toLowerCase().includes(t));

        // Testing and quick tasks -> cloud
        const quickTasks = ['test', 'check', 'list', 'status', 'lint'];
        const isQuick = quickTasks.some(t => step.task.toLowerCase().includes(t));

        return isHeavy && !isQuick;
    }

    /**
     * Wait for an agent to complete
     */
    private waitForAgent(agentId: string): Promise<Agent> {
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const agent = this.agentManager.getAgent(agentId);
                if (!agent || ['completed', 'error', 'stopped'].includes(agent.status)) {
                    clearInterval(checkInterval);
                    resolve(agent || { status: 'error' } as Agent);
                }
            }, 1000);
        });
    }

    /**
     * Extract a summary from an agent's results
     */
    private extractAgentSummary(agent: Agent): string {
        if (!agent.toolHistory || agent.toolHistory.length === 0) {
            return 'No actions taken';
        }

        const lastTool = agent.toolHistory[agent.toolHistory.length - 1];
        if (lastTool.tool === 'task_complete') {
            return lastTool.params?.summary || 'Completed';
        }

        return `Executed ${agent.toolHistory.length} actions`;
    }

    /**
     * Format plan announcement for user
     */
    private formatPlanAnnouncement(plan: TaskPlan): string {
        let msg = `📋 **Plan: ${plan.summary}**\n\n`;
        msg += `Complexity: ${plan.estimatedComplexity}\n\n`;
        msg += `Steps:\n`;

        for (const step of plan.steps) {
            const emoji = this.getAgentEmoji(step.agentType);
            msg += `${step.id}. ${emoji} [${step.agentType}] ${step.description}\n`;
        }

        msg += `\nExecuting...`;
        return msg;
    }

    /**
     * Summarize execution results
     */
    private summarizeResults(plan: TaskPlan, results: AgentResult[]): string {
        const successful = results.filter(r => r.status === 'completed').length;
        const failed = results.filter(r => r.status === 'error').length;

        let msg = `\n---\n✅ **Execution Complete**\n\n`;
        msg += `${successful}/${results.length} steps completed`;
        if (failed > 0) msg += ` (${failed} failed)`;
        msg += `\n\n`;

        for (const result of results) {
            const emoji = result.status === 'completed' ? '✓' : '✗';
            msg += `${emoji} [${result.agentType}] ${result.summary}\n`;
        }

        return msg;
    }

    /**
     * Topological sort of steps based on dependencies
     */
    private topologicalSort(steps: TaskStep[]): TaskStep[] {
        const sorted: TaskStep[] = [];
        const visited = new Set<number>();

        const visit = (step: TaskStep) => {
            if (visited.has(step.id)) return;
            visited.add(step.id);

            for (const depId of step.dependencies) {
                const dep = steps.find(s => s.id === depId);
                if (dep) visit(dep);
            }

            sorted.push(step);
        };

        for (const step of steps) {
            visit(step);
        }

        return sorted;
    }

    private getAgentEmoji(type: AgentType): string {
        const emojis: Record<AgentType, string> = {
            frontend: '🎨',
            backend: '⚙️',
            testing: '🧪',
            browser: '🌐',
            general: '🔧',
            cleaner: '🧹'
        };
        return emojis[type] || '🔧';
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private log(msg: string): void {
        this.outputChannel.appendLine(`[Orchestrator] ${msg}`);
    }

    public getMessages(): OrchestratorMessage[] {
        return this.messages.filter(m => m.role !== 'system');
    }

    public clearHistory(): void {
        this.messages = [this.messages[0]]; // Keep system prompt
    }

    public showOutput(): void {
        this.outputChannel.show();
    }

    public dispose(): void {
        this.outputChannel.dispose();
    }
}
