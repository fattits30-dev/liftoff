import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Agent } from './autonomousAgent';
import { Artifact, AgentMessage } from './agentCommunication';

export interface SessionHistory {
    id: string;
    startTime: number;
    timestamp: number;  // Alias for startTime (for UI compatibility)
    endTime?: number;
    agents: AgentRecord[];
    artifacts: Artifact[];
    messages: AgentMessage[];
}

export interface AgentRecord {
    id: string;
    type: string;
    task: string;
    status: string;
    output: string[];
    startTime: number;
    endTime?: number;
}

export class PersistenceManager {
    private historyDir: string;
    private currentSession: SessionHistory;
    private outputChannel: vscode.OutputChannel;
    private saveScheduled: boolean = false;
    private saveTimer: NodeJS.Timeout | null = null;
    private disposed: boolean = false;
    
    constructor(context: vscode.ExtensionContext) {
        this.historyDir = path.join(context.globalStorageUri.fsPath, 'history');
        this.outputChannel = vscode.window.createOutputChannel('Liftoff Persistence');
        this.currentSession = this.createSession();
        
        // Ensure directory exists asynchronously
        this.ensureHistoryDir();
    }
    
    private async ensureHistoryDir(): Promise<void> {
        try {
            await fs.mkdir(this.historyDir, { recursive: true });
        } catch (err: any) {
            this.log(`Failed to create history directory: ${err.message}`);
        }
    }
    
    private createSession(): SessionHistory {
        const now = Date.now();
        return {
            id: `session-${now}`,
            startTime: now,
            timestamp: now,
            agents: [],
            artifacts: [],
            messages: []
        };
    }
    
    recordAgent(agent: Agent): void {
        if (this.disposed) return;
        
        const record: AgentRecord = {
            id: agent.id,
            type: agent.type,
            task: agent.task,
            status: agent.status,
            output: agent.messages.filter(m => m.role === 'assistant').map(m => m.content),
            startTime: agent.startTime.getTime()
        };
        
        if (agent.endTime) {
            record.endTime = agent.endTime.getTime();
        }
        
        const existing = this.currentSession.agents.findIndex(a => a.id === agent.id);
        if (existing >= 0) {
            this.currentSession.agents[existing] = record;
        } else {
            this.currentSession.agents.push(record);
        }
        
        this.scheduleSave();
    }

    recordArtifact(artifact: Artifact): void {
        if (this.disposed) return;
        this.currentSession.artifacts.push(artifact);
        this.scheduleSave();
    }
    
    recordMessage(message: AgentMessage): void {
        if (this.disposed) return;
        this.currentSession.messages.push(message);
        this.scheduleSave();
    }
    
    /**
     * Schedule a debounced save to prevent rapid writes
     */
    private scheduleSave(): void {
        if (this.saveScheduled || this.disposed) return;
        
        this.saveScheduled = true;
        this.saveTimer = setTimeout(() => {
            this.saveCurrentSession().finally(() => {
                this.saveScheduled = false;
                this.saveTimer = null;
            });
        }, 1000); // Debounce: save at most once per second
    }
    
    private async saveCurrentSession(): Promise<void> {
        if (this.disposed) return;
        
        try {
            const filePath = path.join(this.historyDir, `${this.currentSession.id}.json`);
            await fs.writeFile(filePath, JSON.stringify(this.currentSession, null, 2));
        } catch (err: any) {
            this.log(`Failed to save session: ${err.message}`);
        }
    }
    
    async endSession(): Promise<void> {
        this.currentSession.endTime = Date.now();
        await this.saveCurrentSession();
        this.currentSession = this.createSession();
    }
    
    async getSessionHistory(): Promise<SessionHistory[]> {
        try {
            const files = await fs.readdir(this.historyDir);
            const sessions: SessionHistory[] = [];
            
            for (const file of files) {
                if (file.endsWith('.json')) {
                    try {
                        const data = await fs.readFile(path.join(this.historyDir, file), 'utf-8');
                        sessions.push(JSON.parse(data));
                    } catch {
                        // Skip corrupted files
                    }
                }
            }
            
            return sessions.sort((a, b) => b.startTime - a.startTime);
        } catch {
            return [];
        }
    }
    
    // Sync version for backward compatibility (deprecated)
    getAllSessions(): SessionHistory[] {
        // Return empty - callers should migrate to async getSessionHistory()
        this.log('Warning: getAllSessions() is deprecated, use getSessionHistory() instead');
        return [];
    }
    
    async getSession(sessionId: string): Promise<SessionHistory | null> {
        try {
            const filePath = path.join(this.historyDir, `${sessionId}.json`);
            const data = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(data);
        } catch {
            return null;
        }
    }

    /**
     * Force save (for shutdown)
     */
    async flush(): Promise<void> {
        await this.saveCurrentSession();
    }

    private log(msg: string): void {
        this.outputChannel.appendLine(`[Persistence] ${msg}`);
    }
    
    dispose(): void {
        this.disposed = true;
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        this.saveScheduled = false;
        // Fire off final save but don't wait
        this.saveCurrentSession().catch(() => {});
        this.outputChannel.dispose();
    }
}
