/**
 * Task Entity
 * Domain model for tasks assigned to agents
 */

import { AgentType } from '../interfaces/IAgentRunner';

export type TaskStatus =
    | 'pending'
    | 'queued'
    | 'in_progress'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'blocked';

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

export interface TaskDependency {
    taskId: string;
    type: 'blocks' | 'requires';
}

export interface TaskAttempt {
    agentId: string;
    agentType: AgentType;
    startTime: Date;
    endTime?: Date;
    success: boolean;
    error?: string;
    output?: string;
}

export class Task {
    readonly id: string;
    readonly description: string;
    readonly createdAt: Date;

    // Assignment
    private _assignedAgentType?: AgentType;
    private _assignedAgentId?: string;

    // State
    private _status: TaskStatus = 'pending';
    private _priority: TaskPriority = 'normal';
    private _progress = 0;

    // Context
    private _projectPath?: string;
    private _workingDirectory?: string;
    private _metadata: Record<string, unknown> = {};

    // Dependencies
    private _dependencies: TaskDependency[] = [];
    private _blockedBy: string[] = [];

    // History
    private _attempts: TaskAttempt[] = [];

    // Parent/child relationship
    private _parentTaskId?: string;
    private _subtaskIds: string[] = [];

    // Timestamps
    private _startTime?: Date;
    private _endTime?: Date;
    private _deadline?: Date;

    // Result
    private _output?: string;
    private _error?: string;

    constructor(id: string, description: string, options?: {
        priority?: TaskPriority;
        projectPath?: string;
        workingDirectory?: string;
        parentTaskId?: string;
        deadline?: Date;
        metadata?: Record<string, unknown>;
    }) {
        this.id = id;
        this.description = description;
        this.createdAt = new Date();

        if (options) {
            this._priority = options.priority ?? 'normal';
            this._projectPath = options.projectPath;
            this._workingDirectory = options.workingDirectory;
            this._parentTaskId = options.parentTaskId;
            this._deadline = options.deadline;
            this._metadata = options.metadata ?? {};
        }
    }

    // Getters
    get status(): TaskStatus {
        return this._status;
    }
    get priority(): TaskPriority {
        return this._priority;
    }
    get progress(): number {
        return this._progress;
    }
    get assignedAgentType(): AgentType | undefined {
        return this._assignedAgentType;
    }
    get assignedAgentId(): string | undefined {
        return this._assignedAgentId;
    }
    get projectPath(): string | undefined {
        return this._projectPath;
    }
    get workingDirectory(): string | undefined {
        return this._workingDirectory;
    }
    get metadata(): Record<string, unknown> {
        return this._metadata;
    }
    get dependencies(): readonly TaskDependency[] {
        return this._dependencies;
    }
    get blockedBy(): readonly string[] {
        return this._blockedBy;
    }
    get attempts(): readonly TaskAttempt[] {
        return this._attempts;
    }
    get parentTaskId(): string | undefined {
        return this._parentTaskId;
    }
    get subtaskIds(): readonly string[] {
        return this._subtaskIds;
    }
    get startTime(): Date | undefined {
        return this._startTime;
    }
    get endTime(): Date | undefined {
        return this._endTime;
    }
    get deadline(): Date | undefined {
        return this._deadline;
    }
    get output(): string | undefined {
        return this._output;
    }
    get error(): string | undefined {
        return this._error;
    }

    // Assignment
    assign(agentType: AgentType, agentId?: string): void {
        this._assignedAgentType = agentType;
        this._assignedAgentId = agentId;
    }

    unassign(): void {
        this._assignedAgentType = undefined;
        this._assignedAgentId = undefined;
    }

    // State transitions
    queue(): void {
        if (this._status !== 'pending') {
            throw new Error(`Cannot queue task in status: ${this._status}`);
        }
        this._status = 'queued';
    }

    start(agentId: string, agentType: AgentType): void {
        if (this._status !== 'queued' && this._status !== 'pending') {
            throw new Error(`Cannot start task in status: ${this._status}`);
        }
        if (this._blockedBy.length > 0) {
            throw new Error(`Task is blocked by: ${this._blockedBy.join(', ')}`);
        }
        this._status = 'in_progress';
        this._startTime = new Date();
        this._assignedAgentId = agentId;
        this._assignedAgentType = agentType;

        this._attempts.push({
            agentId,
            agentType,
            startTime: new Date(),
            success: false,
        });
    }

    complete(output?: string): void {
        if (this._status !== 'in_progress') {
            throw new Error(`Cannot complete task in status: ${this._status}`);
        }
        this._status = 'completed';
        this._endTime = new Date();
        this._output = output;
        this._progress = 100;

        // Update last attempt
        const lastAttempt = this._attempts[this._attempts.length - 1];
        if (lastAttempt) {
            lastAttempt.endTime = new Date();
            lastAttempt.success = true;
            lastAttempt.output = output;
        }
    }

    fail(error: string): void {
        if (this._status !== 'in_progress') {
            throw new Error(`Cannot fail task in status: ${this._status}`);
        }
        this._status = 'failed';
        this._endTime = new Date();
        this._error = error;

        // Update last attempt
        const lastAttempt = this._attempts[this._attempts.length - 1];
        if (lastAttempt) {
            lastAttempt.endTime = new Date();
            lastAttempt.success = false;
            lastAttempt.error = error;
        }
    }

    cancel(): void {
        this._status = 'cancelled';
        this._endTime = new Date();
    }

    block(blockingTaskId: string): void {
        if (!this._blockedBy.includes(blockingTaskId)) {
            this._blockedBy.push(blockingTaskId);
        }
        if (this._blockedBy.length > 0) {
            this._status = 'blocked';
        }
    }

    unblock(taskId: string): void {
        const index = this._blockedBy.indexOf(taskId);
        if (index >= 0) {
            this._blockedBy.splice(index, 1);
        }
        if (this._blockedBy.length === 0 && this._status === 'blocked') {
            this._status = 'pending';
        }
    }

    // Reset for retry
    reset(): void {
        this._status = 'pending';
        this._progress = 0;
        this._startTime = undefined;
        this._endTime = undefined;
        this._output = undefined;
        this._error = undefined;
        this._assignedAgentId = undefined;
    }

    // Progress
    setProgress(progress: number): void {
        this._progress = Math.max(0, Math.min(100, progress));
    }

    // Dependencies
    addDependency(dependency: TaskDependency): void {
        if (!this._dependencies.some((d) => d.taskId === dependency.taskId)) {
            this._dependencies.push(dependency);
        }
    }

    removeDependency(taskId: string): void {
        this._dependencies = this._dependencies.filter((d) => d.taskId !== taskId);
    }

    // Subtasks
    addSubtask(subtaskId: string): void {
        if (!this._subtaskIds.includes(subtaskId)) {
            this._subtaskIds.push(subtaskId);
        }
    }

    removeSubtask(subtaskId: string): void {
        const index = this._subtaskIds.indexOf(subtaskId);
        if (index >= 0) {
            this._subtaskIds.splice(index, 1);
        }
    }

    // Metadata
    setMetadata(key: string, value: unknown): void {
        this._metadata[key] = value;
    }

    getMetadata<T>(key: string): T | undefined {
        return this._metadata[key] as T | undefined;
    }

    // Priority
    setPriority(priority: TaskPriority): void {
        this._priority = priority;
    }

    // Duration
    getDuration(): number {
        if (!this._startTime) return 0;
        const end = this._endTime ?? new Date();
        return end.getTime() - this._startTime.getTime();
    }

    // Helpers
    isTerminal(): boolean {
        return ['completed', 'failed', 'cancelled'].includes(this._status);
    }

    isRunning(): boolean {
        return this._status === 'in_progress';
    }

    canRetry(): boolean {
        return this._status === 'failed';
    }

    getAttemptCount(): number {
        return this._attempts.length;
    }

    // Serialization
    toJSON(): Record<string, unknown> {
        return {
            id: this.id,
            description: this.description,
            status: this._status,
            priority: this._priority,
            progress: this._progress,
            assignedAgentType: this._assignedAgentType,
            assignedAgentId: this._assignedAgentId,
            projectPath: this._projectPath,
            workingDirectory: this._workingDirectory,
            createdAt: this.createdAt.toISOString(),
            startTime: this._startTime?.toISOString(),
            endTime: this._endTime?.toISOString(),
            deadline: this._deadline?.toISOString(),
            attemptCount: this._attempts.length,
            subtaskCount: this._subtaskIds.length,
            output: this._output,
            error: this._error,
        };
    }
}
