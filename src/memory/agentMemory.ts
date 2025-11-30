/**
 * AgentMemory - Tiered memory system for agents
 *
 * Follows LangGraph MemorySaver pattern with three tiers:
 * - Working Memory: In-memory, current task context
 * - Session Memory: Episodic memory for the current session
 * - Semantic Memory: Long-term memory with keyword matching
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { extractKeywords } from '../utils';

export interface MemoryEntry {
    id: string;
    timestamp: number;
    agentId: string;
    agentType: string;
    content: string;
    type: 'task' | 'decision' | 'error' | 'success' | 'context';
    keywords: string[];
    relevanceScore?: number;
}

export interface WorkingMemory {
    currentTask: string;
    context: string[];
    recentActions: string[];
    pendingDecisions: string[];
}

export interface SessionMemory {
    sessionId: string;
    startTime: number;
    entries: MemoryEntry[];
    summary?: string;
}

export interface AgentMemoryState {
    working: WorkingMemory;
    session: SessionMemory;
    relevantLongTerm: MemoryEntry[];
}

/**
 * Memory manager for a single agent
 */
export class AgentMemory {
    private agentId: string;
    private agentType: string;
    private working: WorkingMemory;
    private session: SessionMemory;
    private semanticStore: SemanticMemoryStore;

    constructor(
        agentId: string,
        agentType: string,
        semanticStore: SemanticMemoryStore
    ) {
        this.agentId = agentId;
        this.agentType = agentType;
        this.semanticStore = semanticStore;

        // Initialize working memory
        this.working = {
            currentTask: '',
            context: [],
            recentActions: [],
            pendingDecisions: []
        };

        // Initialize session memory
        this.session = {
            sessionId: `${agentId}-${Date.now()}`,
            startTime: Date.now(),
            entries: []
        };
    }

    /**
     * Set the current task context
     */
    setTask(task: string): void {
        this.working.currentTask = task;
        this.addEntry('task', task);

        // Load relevant long-term memories for this task
        this.loadRelevantMemories(task);
    }

    /**
     * Add context to working memory
     */
    addContext(context: string): void {
        this.working.context.push(context);
        if (this.working.context.length > 10) {
            this.working.context.shift();
        }
    }

    /**
     * Record an action taken by the agent
     */
    recordAction(action: string): void {
        this.working.recentActions.push(action);
        if (this.working.recentActions.length > 20) {
            this.working.recentActions.shift();
        }
    }

    /**
     * Record a decision made by the agent
     */
    recordDecision(decision: string): void {
        this.addEntry('decision', decision);
    }

    /**
     * Record an error encountered
     */
    recordError(error: string): void {
        this.addEntry('error', error);

        // Errors are important - save to long-term immediately
        this.semanticStore.addEntry({
            id: `${this.agentId}-error-${Date.now()}`,
            timestamp: Date.now(),
            agentId: this.agentId,
            agentType: this.agentType,
            content: error,
            type: 'error',
            keywords: extractKeywords(error)
        });
    }

    /**
     * Record a successful completion
     */
    recordSuccess(summary: string): void {
        this.addEntry('success', summary);

        // Successes are valuable - save to long-term
        this.semanticStore.addEntry({
            id: `${this.agentId}-success-${Date.now()}`,
            timestamp: Date.now(),
            agentId: this.agentId,
            agentType: this.agentType,
            content: summary,
            type: 'success',
            keywords: extractKeywords(summary)
        });
    }

    /**
     * Get memory state for injection into agent context
     */
    getState(): AgentMemoryState {
        return {
            working: { ...this.working },
            session: { ...this.session },
            relevantLongTerm: this.semanticStore.query(this.working.currentTask, 5)
        };
    }

    /**
     * Format memory for system prompt injection
     */
    formatForPrompt(): string {
        const state = this.getState();
        let prompt = '';

        if (state.relevantLongTerm.length > 0) {
            prompt += '\n## Relevant Past Experience\n';
            for (const mem of state.relevantLongTerm) {
                const icon = mem.type === 'success' ? '✓' : mem.type === 'error' ? '✗' : '•';
                prompt += `${icon} ${mem.content}\n`;
            }
        }

        if (state.working.context.length > 0) {
            prompt += '\n## Current Context\n';
            prompt += state.working.context.slice(-5).join('\n');
        }

        if (state.working.recentActions.length > 0) {
            prompt += '\n## Recent Actions\n';
            prompt += state.working.recentActions.slice(-5).join('\n');
        }

        return prompt;
    }

    /**
     * Summarize session on completion
     */
    summarizeSession(): string {
        const successes = this.session.entries.filter(e => e.type === 'success').length;
        const errors = this.session.entries.filter(e => e.type === 'error').length;
        const decisions = this.session.entries.filter(e => e.type === 'decision').length;

        const summary = `Session ${this.session.sessionId}: ` +
            `${successes} successes, ${errors} errors, ${decisions} decisions. ` +
            `Task: ${this.working.currentTask}`;

        this.session.summary = summary;
        return summary;
    }

    private addEntry(type: MemoryEntry['type'], content: string): void {
        this.session.entries.push({
            id: `${this.agentId}-${type}-${Date.now()}`,
            timestamp: Date.now(),
            agentId: this.agentId,
            agentType: this.agentType,
            content,
            type,
            keywords: extractKeywords(content)
        });
    }

    private loadRelevantMemories(task: string): void {
        const relevant = this.semanticStore.query(task, 10);
        for (const mem of relevant) {
            if (mem.type === 'success' || mem.type === 'error') {
                this.addContext(`[Past ${mem.type}]: ${mem.content}`);
            }
        }
    }
}


/**
 * Persistent semantic memory store
 * Shared across all agents, persisted to disk
 * 
 * Uses async I/O to prevent blocking extension host
 */
export class SemanticMemoryStore {
    private entries: MemoryEntry[] = [];
    private storagePath: string;
    private maxEntries: number = 1000;
    private outputChannel: vscode.OutputChannel;
    private saveScheduled: boolean = false;
    private disposed: boolean = false;

    constructor(storagePath: string) {
        this.storagePath = storagePath;
        this.outputChannel = vscode.window.createOutputChannel('Liftoff Memory');
        // Load is called separately via initialize()
    }

    /**
     * Initialize - call this after construction
     */
    async initialize(): Promise<void> {
        await this.load();
    }

    /**
     * Add an entry to the semantic store
     */
    addEntry(entry: MemoryEntry): void {
        if (this.disposed) return;
        
        this.entries.push(entry);

        // Prune old entries if over limit
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, this.maxEntries);
        }

        this.scheduleSave();
    }

    /**
     * Query for relevant memories using keyword matching
     */
    query(text: string, limit: number = 5): MemoryEntry[] {
        const queryKeywords = extractKeywords(text);

        const scored = this.entries.map(entry => {
            const overlap = entry.keywords.filter(k => queryKeywords.includes(k)).length;
            const recency = 1 / (1 + (Date.now() - entry.timestamp) / (1000 * 60 * 60 * 24));
            const typeBoost = entry.type === 'success' ? 1.5 : entry.type === 'error' ? 1.3 : 1.0;

            return {
                entry,
                score: (overlap * typeBoost) + (recency * 0.1)
            };
        });

        return scored
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(s => ({ ...s.entry, relevanceScore: s.score }));
    }

    /**
     * Get all entries for a specific agent type
     */
    getByAgentType(agentType: string): MemoryEntry[] {
        return this.entries.filter(e => e.agentType === agentType);
    }

    /**
     * Get recent errors
     */
    getRecentErrors(limit: number = 10): MemoryEntry[] {
        return this.entries
            .filter(e => e.type === 'error')
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    /**
     * Get recent successes
     */
    getRecentSuccesses(limit: number = 10): MemoryEntry[] {
        return this.entries
            .filter(e => e.type === 'success')
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    /**
     * Load from disk (async)
     */
    private async load(): Promise<void> {
        try {
            const data = await fs.readFile(this.storagePath, 'utf-8');
            this.entries = JSON.parse(data);
            this.log(`Loaded ${this.entries.length} memory entries`);
        } catch (err: any) {
            if (err.code !== 'ENOENT') {
                this.log(`Failed to load semantic memory: ${err.message}`);
            }
            this.entries = [];
        }
    }

    /**
     * Schedule a debounced save to prevent rapid writes
     */
    private scheduleSave(): void {
        if (this.saveScheduled || this.disposed) return;
        
        this.saveScheduled = true;
        setTimeout(() => {
            this.save().finally(() => {
                this.saveScheduled = false;
            });
        }, 1000); // Debounce: save at most once per second
    }

    /**
     * Save to disk (async)
     */
    private async save(): Promise<void> {
        if (this.disposed) return;
        
        try {
            const dir = path.dirname(this.storagePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(this.storagePath, JSON.stringify(this.entries, null, 2));
        } catch (err: any) {
            this.log(`Failed to save semantic memory: ${err.message}`);
        }
    }

    /**
     * Force save (for shutdown)
     */
    async flush(): Promise<void> {
        await this.save();
    }

    private log(msg: string): void {
        this.outputChannel.appendLine(`[SemanticMemory] ${msg}`);
    }

    /**
     * Clear all entries
     */
    async clear(): Promise<void> {
        this.entries = [];
        await this.save();
    }

    /**
     * Get statistics
     */
    getStats(): { total: number; byType: Record<string, number>; byAgent: Record<string, number> } {
        const byType: Record<string, number> = {};
        const byAgent: Record<string, number> = {};

        for (const entry of this.entries) {
            byType[entry.type] = (byType[entry.type] || 0) + 1;
            byAgent[entry.agentType] = (byAgent[entry.agentType] || 0) + 1;
        }

        return { total: this.entries.length, byType, byAgent };
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.disposed = true;
        // Fire off final save but don't wait
        this.save().catch(() => {});
        this.outputChannel.dispose();
    }
}


/**
 * Memory manager for the orchestrator
 * Uses async I/O and proper disposal
 */
export class OrchestratorMemory {
    private sessionPlans: Array<{
        id: string;
        timestamp: number;
        task: string;
        plan: any;
        result: 'success' | 'partial' | 'failed';
    }> = [];
    private semanticStore: SemanticMemoryStore;
    private storagePath: string;
    private outputChannel: vscode.OutputChannel;
    private saveScheduled: boolean = false;
    private disposed: boolean = false;

    constructor(storagePath: string, semanticStore: SemanticMemoryStore) {
        this.storagePath = storagePath;
        this.semanticStore = semanticStore;
        this.outputChannel = vscode.window.createOutputChannel('Liftoff Orchestrator Memory');
    }

    /**
     * Initialize - call after construction
     */
    async initialize(): Promise<void> {
        await this.load();
    }

    /**
     * Record a plan execution
     */
    recordPlan(task: string, plan: any, result: 'success' | 'partial' | 'failed'): void {
        if (this.disposed) return;
        
        this.sessionPlans.push({
            id: `plan-${Date.now()}`,
            timestamp: Date.now(),
            task,
            plan,
            result
        });

        // Save to semantic memory
        this.semanticStore.addEntry({
            id: `orchestrator-plan-${Date.now()}`,
            timestamp: Date.now(),
            agentId: 'orchestrator',
            agentType: 'orchestrator',
            content: `Plan for "${task}": ${result}. Steps: ${plan.steps?.length || 0}`,
            type: result === 'success' ? 'success' : result === 'failed' ? 'error' : 'decision',
            keywords: extractKeywords(task)
        });

        this.scheduleSave();
    }

    /**
     * Get similar past plans
     */
    getSimilarPlans(task: string, limit: number = 3): Array<{ task: string; plan: any; result: string }> {
        const keywords = extractKeywords(task);

        return this.sessionPlans
            .map(p => ({
                ...p,
                score: extractKeywords(p.task).filter(k => keywords.includes(k)).length
            }))
            .filter(p => p.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(p => ({ task: p.task, plan: p.plan, result: p.result }));
    }

    /**
     * Get success rate for similar tasks
     */
    getSuccessRate(task: string): number {
        const similar = this.getSimilarPlans(task, 10);
        if (similar.length === 0) return 0.5;

        const successes = similar.filter(p => p.result === 'success').length;
        return successes / similar.length;
    }

    /**
     * Schedule a debounced save
     */
    private scheduleSave(): void {
        if (this.saveScheduled || this.disposed) return;
        
        this.saveScheduled = true;
        setTimeout(() => {
            this.save().finally(() => {
                this.saveScheduled = false;
            });
        }, 1000);
    }

    /**
     * Load from disk (async)
     */
    private async load(): Promise<void> {
        try {
            const data = await fs.readFile(this.storagePath, 'utf-8');
            this.sessionPlans = JSON.parse(data);
            this.log(`Loaded ${this.sessionPlans.length} plans`);
        } catch (err: any) {
            if (err.code !== 'ENOENT') {
                this.log(`Failed to load orchestrator memory: ${err.message}`);
            }
            this.sessionPlans = [];
        }
    }

    /**
     * Save to disk (async)
     */
    private async save(): Promise<void> {
        if (this.disposed) return;
        
        try {
            const dir = path.dirname(this.storagePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(this.storagePath, JSON.stringify(this.sessionPlans, null, 2));
        } catch (err: any) {
            this.log(`Failed to save orchestrator memory: ${err.message}`);
        }
    }

    /**
     * Force save (for shutdown)
     */
    async flush(): Promise<void> {
        await this.save();
    }

    private log(msg: string): void {
        this.outputChannel.appendLine(`[OrchestratorMemory] ${msg}`);
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.disposed = true;
        this.save().catch(() => {});
        this.outputChannel.dispose();
    }
}
