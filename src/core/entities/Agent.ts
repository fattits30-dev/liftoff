/**
 * Agent Entity
 * Domain model for AI agents
 */

import { AgentType, AgentStatus, AgentConfig, AgentContext } from '../interfaces/IAgentRunner';
import { Message } from '../interfaces/ILLMProvider';
import { ToolResult } from '../interfaces/IToolExecutor';

export interface ToolCallRecord {
    id: string;
    tool: string;
    args: Record<string, unknown>;
    result: ToolResult;
    timestamp: Date;
    duration: number;
}

export interface HierarchyInfo {
    parentId?: string;
    childIds: string[];
    depth: number;
    maxDepth: number;
}

export class Agent {
    readonly id: string;
    readonly type: AgentType;
    readonly name: string;
    readonly systemPrompt: string;
    readonly maxIterations: number;
    readonly maxTokens: number;
    readonly temperature: number;
    readonly allowedTools: Set<string>;

    // State
    private _status: AgentStatus = 'idle';
    private _currentTask?: string;
    private _progress = 0;
    private _iterations = 0;
    private _messages: Message[] = [];
    private _toolCalls: ToolCallRecord[] = [];
    private _lastError?: string;
    private _startTime?: Date;
    private _endTime?: Date;

    // Context
    private _context: AgentContext;

    // Hierarchy
    private _hierarchy: HierarchyInfo;

    constructor(config: AgentConfig, context: AgentContext) {
        this.id = config.id;
        this.type = config.type;
        this.name = config.name;
        this.systemPrompt = config.systemPrompt;
        this.maxIterations = config.maxIterations ?? 50;
        this.maxTokens = config.maxTokens ?? 4096;
        this.temperature = config.temperature ?? 0.7;
        this.allowedTools = new Set(config.tools ?? []);

        this._context = context;
        this._hierarchy = {
            parentId: context.parentAgentId,
            childIds: [],
            depth: context.depth,
            maxDepth: context.maxDepth,
        };

        // Initialize with system message
        this._messages.push({
            role: 'system',
            content: this.systemPrompt,
        });
    }

    // Getters
    get status(): AgentStatus {
        return this._status;
    }
    get currentTask(): string | undefined {
        return this._currentTask;
    }
    get progress(): number {
        return this._progress;
    }
    get iterations(): number {
        return this._iterations;
    }
    get messages(): readonly Message[] {
        return this._messages;
    }
    get toolCalls(): readonly ToolCallRecord[] {
        return this._toolCalls;
    }
    get lastError(): string | undefined {
        return this._lastError;
    }
    get startTime(): Date | undefined {
        return this._startTime;
    }
    get endTime(): Date | undefined {
        return this._endTime;
    }
    get context(): AgentContext {
        return this._context;
    }
    get hierarchy(): HierarchyInfo {
        return this._hierarchy;
    }

    // State transitions
    start(task: string): void {
        if (this._status !== 'idle' && this._status !== 'paused') {
            throw new Error(`Cannot start agent in status: ${this._status}`);
        }
        this._status = 'executing';
        this._currentTask = task;
        this._startTime = new Date();
        this._messages.push({ role: 'user', content: task });
    }

    pause(): void {
        if (this._status !== 'executing' && this._status !== 'waiting') {
            throw new Error(`Cannot pause agent in status: ${this._status}`);
        }
        this._status = 'paused';
    }

    resume(): void {
        if (this._status !== 'paused') {
            throw new Error(`Cannot resume agent in status: ${this._status}`);
        }
        this._status = 'executing';
    }

    complete(output?: string): void {
        this._status = 'completed';
        this._endTime = new Date();
        if (output) {
            this._messages.push({ role: 'assistant', content: output });
        }
    }

    fail(error: string): void {
        this._status = 'failed';
        this._endTime = new Date();
        this._lastError = error;
    }

    cancel(): void {
        this._status = 'cancelled';
        this._endTime = new Date();
    }

    // Message management
    addMessage(message: Message): void {
        this._messages.push(message);
    }

    addAssistantMessage(content: string): void {
        this._messages.push({ role: 'assistant', content });
    }

    addToolResult(toolCallId: string, content: string): void {
        this._messages.push({
            role: 'tool',
            content,
            toolCallId,
        });
    }

    // Tool tracking
    recordToolCall(
        id: string,
        tool: string,
        args: Record<string, unknown>,
        result: ToolResult,
        duration: number
    ): void {
        this._toolCalls.push({
            id,
            tool,
            args,
            result,
            timestamp: new Date(),
            duration,
        });
    }

    // Progress tracking
    incrementIteration(): void {
        this._iterations++;
        this._progress = Math.min(100, (this._iterations / this.maxIterations) * 100);
    }

    setProgress(progress: number): void {
        this._progress = Math.max(0, Math.min(100, progress));
    }

    // Hierarchy management
    addChild(childId: string): void {
        if (!this._hierarchy.childIds.includes(childId)) {
            this._hierarchy.childIds.push(childId);
        }
    }

    removeChild(childId: string): void {
        const index = this._hierarchy.childIds.indexOf(childId);
        if (index >= 0) {
            this._hierarchy.childIds.splice(index, 1);
        }
    }

    canSpawnChild(): boolean {
        return this._hierarchy.depth < this._hierarchy.maxDepth;
    }

    // Tool permissions
    canUseTool(toolName: string): boolean {
        // Empty set means all tools allowed
        if (this.allowedTools.size === 0) return true;
        return this.allowedTools.has(toolName);
    }

    // Duration
    getDuration(): number {
        if (!this._startTime) return 0;
        const end = this._endTime ?? new Date();
        return end.getTime() - this._startTime.getTime();
    }

    // Serialization
    toState(): {
        id: string;
        type: AgentType;
        status: AgentStatus;
        currentTask?: string;
        progress: number;
        iterations: number;
        lastError?: string;
        startTime?: string;
        endTime?: string;
        messageCount: number;
        toolCallCount: number;
    } {
        return {
            id: this.id,
            type: this.type,
            status: this._status,
            currentTask: this._currentTask,
            progress: this._progress,
            iterations: this._iterations,
            lastError: this._lastError,
            startTime: this._startTime?.toISOString(),
            endTime: this._endTime?.toISOString(),
            messageCount: this._messages.length,
            toolCallCount: this._toolCalls.length,
        };
    }
}
