/**
 * TaskWorker [DEPRECATED]
 * This worker is deprecated after migration to direct MCP tools.
 * UnifiedExecutor was removed due to security vulnerabilities.
 * Use MCP Router with local__ tools instead.
 */

import * as vscode from 'vscode';
// DEPRECATED: UnifiedExecutor removed due to VM sandbox security vulnerability
// import { UnifiedExecutor } from './mcp/unified-executor';
import { AgentType } from './types/agentTypes';

// Type stub for deprecated UnifiedExecutor
class UnifiedExecutor {
    constructor(_workspaceRoot: string) {
        throw new Error('UnifiedExecutor is deprecated due to security vulnerabilities. Use MCP tools instead.');
    }
    async execute(_code: string): Promise<any> {
        throw new Error('execute() is deprecated. Use MCP tools instead.');
    }
    async dispose(): Promise<void> {}
}

export interface WorkerTask {
    id: string;
    type: 'execute' | 'read' | 'write' | 'shell' | 'browser';
    code?: string;
    path?: string;
    content?: string;
    command?: string;
}

export interface WorkerResult {
    taskId: string;
    success: boolean;
    output: string;
    error?: string;
    duration: number;
    // Editor stats for file operations
    linesAdded?: number;
    linesRemoved?: number;
    filePath?: string;
    // Browser automation
    screenshot?: string; // base64 encoded screenshot
}

export type WorkerStatus = 'idle' | 'busy' | 'completed' | 'error';

/**
 * File lock manager to prevent race conditions
 */
class FileLockManager {
    private locks: Map<string, { workerId: string; timestamp: number }> = new Map();
    private readonly LOCK_TIMEOUT = 30000; // 30 seconds max lock

    acquire(path: string, workerId: string): boolean {
        const existing = this.locks.get(path);
        const now = Date.now();
        
        // Check if lock exists and is still valid
        if (existing && (now - existing.timestamp) < this.LOCK_TIMEOUT) {
            if (existing.workerId !== workerId) {
                return false; // Locked by another worker
            }
            // Same worker, refresh timestamp
            existing.timestamp = now;
            return true;
        }
        
        // Acquire lock
        this.locks.set(path, { workerId, timestamp: now });
        return true;
    }

    release(path: string, workerId: string): void {
        const lock = this.locks.get(path);
        if (lock && lock.workerId === workerId) {
            this.locks.delete(path);
        }
    }

    releaseAll(workerId: string): void {
        for (const [path, lock] of this.locks.entries()) {
            if (lock.workerId === workerId) {
                this.locks.delete(path);
            }
        }
    }

    isLocked(path: string): boolean {
        const lock = this.locks.get(path);
        if (!lock) return false;
        return (Date.now() - lock.timestamp) < this.LOCK_TIMEOUT;
    }
}

// Singleton lock manager shared across all workers
export const fileLockManager = new FileLockManager();

/**
 * TaskWorker - A subprocess that executes tool calls
 * 
 * Key principle: Workers DON'T think. They just execute.
 * The Orchestrator is the only entity that uses LLM.
 */
export class TaskWorker {
    public readonly id: string;
    public readonly type: AgentType;
    public status: WorkerStatus = 'idle';
    public currentTask: WorkerTask | null = null;
    public lastResult: WorkerResult | null = null;
    
    private executor: UnifiedExecutor;
    private outputChannel: vscode.OutputChannel;

    private readonly _onStatusChange = new vscode.EventEmitter<WorkerStatus>();
    public readonly onStatusChange = this._onStatusChange.event;

    private readonly _onOutput = new vscode.EventEmitter<{ type: 'log' | 'result' | 'error'; content: string }>();
    public readonly onOutput = this._onOutput.event;

    constructor(type: AgentType, workspaceRoot: string, outputChannel: vscode.OutputChannel) {
        this.id = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        this.type = type;
        this.executor = new UnifiedExecutor(workspaceRoot);
        this.outputChannel = outputChannel;
    }

    /**
     * Execute a single task - NO LLM reasoning here
     */
    async execute(task: WorkerTask): Promise<WorkerResult> {
        const startTime = Date.now();
        this.currentTask = task;
        this.status = 'busy';
        this._onStatusChange.fire(this.status);

        this.log(`Executing task ${task.id}: ${task.type}`);

        try {
            let output: string;
            let success: boolean;
            let error: string | undefined;
            let linesAdded: number | undefined;
            let linesRemoved: number | undefined;
            let filePath: string | undefined;
            let screenshot: string | undefined;

            switch (task.type) {
                case 'execute':
                    if (!task.code) {
                        throw new Error('No code provided for execute task');
                    }
                    const result = await this.executor.execute(task.code);
                    success = result.success;
                    output = result.success 
                        ? (typeof result.result === 'object' 
                            ? JSON.stringify(result.result, null, 2) 
                            : String(result.result ?? 'undefined'))
                        : '';
                    error = result.error;
                    // Capture stats from execution
                    linesAdded = result.linesAdded;
                    linesRemoved = result.linesRemoved;
                    filePath = result.filePath;
                    screenshot = result.screenshot;
                    break;

                case 'read':
                    if (!task.path) throw new Error('No path for read task');
                    const readResult = await this.executor.execute(`return fs.read('${task.path}')`);
                    success = readResult.success;
                    output = readResult.success ? String(readResult.result) : '';
                    error = readResult.error;
                    filePath = task.path;
                    break;

                case 'write':
                    if (!task.path || task.content === undefined) {
                        throw new Error('Missing path or content for write task');
                    }
                    // Acquire file lock
                    if (!fileLockManager.acquire(task.path, this.id)) {
                        throw new Error(`File ${task.path} is locked by another worker`);
                    }
                    try {
                        const escapedContent = task.content.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
                        const writeResult = await this.executor.execute(`return fs.write('${task.path}', '${escapedContent}')`);
                        success = writeResult.success;
                        output = writeResult.success ? 'File written successfully' : '';
                        error = writeResult.error;
                        // Capture file stats
                        linesAdded = writeResult.linesAdded;
                        linesRemoved = writeResult.linesRemoved;
                        filePath = task.path;
                    } finally {
                        fileLockManager.release(task.path, this.id);
                    }
                    break;

                case 'shell':
                    if (!task.command) throw new Error('No command for shell task');
                    const shellResult = await this.executor.execute(`return shell.run('${task.command}')`);
                    success = shellResult.success;
                    output = shellResult.success ? String(shellResult.result) : '';
                    error = shellResult.error;
                    break;

                case 'browser':
                    // Browser tasks are passed through to executor
                    if (!task.code) throw new Error('No code for browser task');
                    const browserResult = await this.executor.execute(task.code);
                    success = browserResult.success;
                    output = browserResult.success ? String(browserResult.result) : '';
                    error = browserResult.error;
                    // Capture screenshot if taken
                    screenshot = browserResult.screenshot;
                    break;

                default:
                    throw new Error(`Unknown task type: ${task.type}`);
            }

            const workerResult: WorkerResult = {
                taskId: task.id,
                success,
                output: output.substring(0, 50000), // Limit output size
                error,
                duration: Date.now() - startTime,
                linesAdded,
                linesRemoved,
                filePath,
                screenshot
            };

            this.lastResult = workerResult;
            this.status = success ? 'completed' : 'error';
            this._onStatusChange.fire(this.status);
            this._onOutput.fire({ type: success ? 'result' : 'error', content: output || error || '' });

            return workerResult;

        } catch (err: any) {
            const result: WorkerResult = {
                taskId: task.id,
                success: false,
                output: '',
                error: err.message,
                duration: Date.now() - startTime
            };

            this.lastResult = result;
            this.status = 'error';
            this._onStatusChange.fire(this.status);
            this._onOutput.fire({ type: 'error', content: err.message });

            return result;
        } finally {
            this.currentTask = null;
            // Release any remaining locks
            fileLockManager.releaseAll(this.id);
        }
    }

    /**
     * Reset worker to idle state
     */
    reset(): void {
        this.status = 'idle';
        this.currentTask = null;
        this._onStatusChange.fire(this.status);
    }

    private log(msg: string): void {
        this.outputChannel.appendLine(`[Worker:${this.type}] ${msg}`);
    }

    dispose(): void {
        fileLockManager.releaseAll(this.id);
        this.executor.dispose();
    }
}

/**
 * WorkerPool - Manages a pool of workers for parallel execution
 * 
 * The Orchestrator uses this to dispatch tasks to workers.
 * Workers execute in parallel but with proper file locking.
 */
export class WorkerPool {
    private workers: Map<string, TaskWorker> = new Map();
    private outputChannel: vscode.OutputChannel;
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.outputChannel = vscode.window.createOutputChannel('Liftoff Workers');
    }

    /**
     * Get or create a worker for a specific agent type
     */
    getWorker(type: AgentType): TaskWorker {
        const key = type;
        let worker = this.workers.get(key);
        
        if (!worker || worker.status === 'error') {
            // Create new worker
            worker = new TaskWorker(type, this.workspaceRoot, this.outputChannel);
            this.workers.set(key, worker);
            this.outputChannel.appendLine(`[WorkerPool] Created ${type} worker: ${worker.id}`);
        }
        
        return worker;
    }

    /**
     * Execute a task on the appropriate worker
     */
    async executeTask(type: AgentType, task: WorkerTask): Promise<WorkerResult> {
        const worker = this.getWorker(type);
        
        // Wait if worker is busy
        if (worker.status === 'busy') {
            await this.waitForWorker(worker);
        }
        
        return worker.execute(task);
    }

    /**
     * Execute multiple tasks in parallel (with proper locking)
     */
    async executeParallel(tasks: Array<{ type: AgentType; task: WorkerTask }>): Promise<WorkerResult[]> {
        const promises = tasks.map(({ type, task }) => this.executeTask(type, task));
        return Promise.all(promises);
    }

    /**
     * Wait for a worker to become available
     */
    private waitForWorker(worker: TaskWorker, timeout: number = 60000): Promise<void> {
        return new Promise((resolve, reject) => {
            if (worker.status !== 'busy') {
                resolve();
                return;
            }

            const timeoutId = setTimeout(() => {
                disposable.dispose();
                reject(new Error('Worker timeout'));
            }, timeout);

            const disposable = worker.onStatusChange((status) => {
                if (status !== 'busy') {
                    clearTimeout(timeoutId);
                    disposable.dispose();
                    resolve();
                }
            });
        });
    }

    /**
     * Get all active workers
     */
    getActiveWorkers(): TaskWorker[] {
        return Array.from(this.workers.values()).filter(w => w.status === 'busy');
    }

    /**
     * Get pool status
     */
    getStatus(): { total: number; busy: number; idle: number } {
        const workers = Array.from(this.workers.values());
        return {
            total: workers.length,
            busy: workers.filter(w => w.status === 'busy').length,
            idle: workers.filter(w => w.status === 'idle').length
        };
    }

    dispose(): void {
        for (const worker of this.workers.values()) {
            worker.dispose();
        }
        this.workers.clear();
        this.outputChannel.dispose();
    }
}
