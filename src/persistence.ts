import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Agent } from './agentManager';
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
    
    constructor(context: vscode.ExtensionContext) {
        this.historyDir = path.join(context.globalStorageUri.fsPath, 'history');
        this.ensureHistoryDir();
        this.currentSession = this.createSession();
    }
    
    private ensureHistoryDir(): void {
        if (!fs.existsSync(this.historyDir)) {
            fs.mkdirSync(this.historyDir, { recursive: true });
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
        
        this.saveCurrentSession();
    }

    recordArtifact(artifact: Artifact): void {
        this.currentSession.artifacts.push(artifact);
        this.saveCurrentSession();
    }
    
    recordMessage(message: AgentMessage): void {
        this.currentSession.messages.push(message);
        this.saveCurrentSession();
    }
    
    private saveCurrentSession(): void {
        const filePath = path.join(this.historyDir, `${this.currentSession.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(this.currentSession, null, 2));
    }
    
    endSession(): void {
        this.currentSession.endTime = Date.now();
        this.saveCurrentSession();
        this.currentSession = this.createSession();
    }
    
    getSessionHistory(): SessionHistory[] {
        const files = fs.readdirSync(this.historyDir).filter(f => f.endsWith('.json'));
        return files.map(f => {
            const content = fs.readFileSync(path.join(this.historyDir, f), 'utf-8');
            return JSON.parse(content) as SessionHistory;
        }).sort((a, b) => b.startTime - a.startTime);
    }

    // Alias for getSessionHistory
    getAllSessions(): SessionHistory[] {
        return this.getSessionHistory();
    }
    
    getSession(id: string): SessionHistory | null {
        const filePath = path.join(this.historyDir, `${id}.json`);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content);
        }
        return null;
    }
    
    getCurrentSession(): SessionHistory {
        return this.currentSession;
    }
    
    clearHistory(): void {
        const files = fs.readdirSync(this.historyDir);
        files.forEach(f => fs.unlinkSync(path.join(this.historyDir, f)));
    }
}
