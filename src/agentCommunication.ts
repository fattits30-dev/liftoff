import * as vscode from 'vscode';
import { EventEmitter } from 'events';

export interface Artifact {
    id: string;
    agentId: string;
    type: 'code' | 'screenshot' | 'report' | 'test-result' | 'file';
    title?: string;
    content: string;
    filePath?: string;
    language?: string;
    timestamp: Date;
}

// Alias for backward compatibility
export type ArtifactTimestamp = Date | number;

export interface AgentMessage {
    id: string;
    fromAgent: string;
    toAgent: string | 'broadcast';
    type: 'request' | 'response' | 'info' | 'handoff';
    content: string;
    data?: any;
    timestamp: number;
}

export class AgentCommunication extends EventEmitter {
    private messages: AgentMessage[] = [];
    private artifacts: Artifact[] = [];
    
    constructor() {
        super();
    }

    // Typed event listener for messages
    onMessage(callback: (msg: AgentMessage) => void): void {
        this.on('message', callback);
    }
    
    sendMessage(from: string, to: string | 'broadcast', type: AgentMessage['type'], content: string, data?: any): AgentMessage {
        const message: AgentMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            fromAgent: from,
            toAgent: to,
            type,
            content,
            data,
            timestamp: Date.now()
        };
        
        this.messages.push(message);
        this.emit('message', message);
        
        // If broadcast, emit to all listeners
        if (to === 'broadcast') {
            this.emit('broadcast', message);
        } else {
            this.emit(`message:${to}`, message);
        }
        
        return message;
    }

    addArtifact(agentId: string, type: Artifact['type'], title: string, content: string, options?: { filePath?: string; language?: string }): Artifact {
        const artifact: Artifact = {
            id: `artifact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            agentId,
            type,
            title,
            content,
            filePath: options?.filePath,
            language: options?.language,
            timestamp: new Date()
        };
        
        this.artifacts.push(artifact);
        this.emit('artifact', artifact);
        return artifact;
    }
    
    getMessagesForAgent(agentId: string): AgentMessage[] {
        return this.messages.filter(m => 
            m.toAgent === agentId || 
            m.toAgent === 'broadcast' || 
            m.fromAgent === agentId
        );
    }
    
    getArtifactsForAgent(agentId: string): Artifact[] {
        return this.artifacts.filter(a => a.agentId === agentId);
    }
    
    getAllMessages(): AgentMessage[] {
        return [...this.messages];
    }
    
    getAllArtifacts(): Artifact[] {
        return [...this.artifacts];
    }
    
    // Handoff task from one agent to another
    handoff(fromAgent: string, toAgent: string, task: string, context: any): AgentMessage {
        return this.sendMessage(fromAgent, toAgent, 'handoff', task, context);
    }
    
    // Request help from another agent
    requestHelp(fromAgent: string, toAgent: string, question: string): AgentMessage {
        return this.sendMessage(fromAgent, toAgent, 'request', question);
    }
    
    // Share info with all agents
    broadcast(fromAgent: string, info: string, data?: any): AgentMessage {
        return this.sendMessage(fromAgent, 'broadcast', 'info', info, data);
    }
}

export const agentComms = new AgentCommunication();
