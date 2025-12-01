/**
 * .liftoff Directory Manager
 *
 * Manages the .liftoff/ directory structure for context and state persistence
 * Structure:
 *   .liftoff/
 *   ├── plan.json          - Main plan file (phases, progress, features)
 *   ├── spec.json          - Generated specification
 *   ├── architecture.json  - System architecture
 *   ├── lessons.json       - Lessons learned (managed by LessonsManager)
 *   ├── context.md         - Human-readable implementation notes
 *   └── status.json        - Current build status snapshot
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { AppSpec, Architecture } from './types';
import { LiftoffPlan } from './liftoffPlan';

export interface LiftoffStatus {
    currentPhase: string;
    phaseProgress: number; // 0-100
    lastUpdated: Date;
    activeAgents: string[];
    completedTasks: number;
    totalTasks: number;
    blockers: string[];
}

export class LiftoffDirectory {
    private readonly LIFTOFF_DIR = '.liftoff';
    private readonly FILES = {
        plan: 'plan.json',
        spec: 'spec.json',
        architecture: 'architecture.json',
        lessons: 'lessons.json',
        context: 'context.md',
        status: 'status.json'
    };

    constructor(private projectPath: string) {}

    /**
     * Initialize .liftoff directory structure
     */
    async initialize(): Promise<void> {
        const liftoffPath = this.getLiftoffPath();

        try {
            await fs.mkdir(liftoffPath, { recursive: true });
            console.log(`[LiftoffDirectory] Created directory: ${liftoffPath}`);
        } catch (error) {
            console.error('[LiftoffDirectory] Failed to create directory:', error);
            throw new Error(`Failed to initialize .liftoff directory: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Check if .liftoff directory exists
     */
    async exists(): Promise<boolean> {
        try {
            const stats = await fs.stat(this.getLiftoffPath());
            return stats.isDirectory();
        } catch {
            return false;
        }
    }

    /**
     * Save plan file
     */
    async savePlan(plan: LiftoffPlan): Promise<void> {
        const filePath = this.getFilePath('plan');
        const content = JSON.stringify(plan, null, 2);
        await fs.writeFile(filePath, content, 'utf-8');
        console.log(`[LiftoffDirectory] Saved plan to ${filePath}`);
    }

    /**
     * Load plan file
     */
    async loadPlan(): Promise<LiftoffPlan | null> {
        try {
            const filePath = this.getFilePath('plan');
            const content = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(content);

            // Convert date strings back to Date objects
            parsed.createdAt = new Date(parsed.createdAt);
            parsed.updatedAt = new Date(parsed.updatedAt);
            Object.values(parsed.phases).forEach((phase: any) => {
                if (phase.startedAt) phase.startedAt = new Date(phase.startedAt);
                if (phase.completedAt) phase.completedAt = new Date(phase.completedAt);
            });

            return parsed;
        } catch (_error) {
            console.log('[LiftoffDirectory] No existing plan found');
            return null;
        }
    }

    /**
     * Save spec file
     */
    async saveSpec(spec: AppSpec): Promise<void> {
        const filePath = this.getFilePath('spec');
        const content = JSON.stringify(spec, null, 2);
        await fs.writeFile(filePath, content, 'utf-8');
        console.log(`[LiftoffDirectory] Saved spec to ${filePath}`);
    }

    /**
     * Load spec file
     */
    async loadSpec(): Promise<AppSpec | null> {
        try {
            const filePath = this.getFilePath('spec');
            const content = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(content);
        } catch {
            return null;
        }
    }

    /**
     * Save architecture file
     */
    async saveArchitecture(architecture: Architecture): Promise<void> {
        const filePath = this.getFilePath('architecture');
        const content = JSON.stringify(architecture, null, 2);
        await fs.writeFile(filePath, content, 'utf-8');
        console.log(`[LiftoffDirectory] Saved architecture to ${filePath}`);
    }

    /**
     * Load architecture file
     */
    async loadArchitecture(): Promise<Architecture | null> {
        try {
            const filePath = this.getFilePath('architecture');
            const content = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(content);
        } catch {
            return null;
        }
    }

    /**
     * Update context.md with implementation notes
     */
    async appendContext(heading: string, content: string): Promise<void> {
        const filePath = this.getFilePath('context');
        const timestamp = new Date().toISOString();
        const entry = `\n\n## ${heading}\n*${timestamp}*\n\n${content}`;

        try {
            await fs.appendFile(filePath, entry, 'utf-8');
        } catch {
            // File doesn't exist yet, create it
            const header = `# Implementation Context\n\nThis file tracks key decisions, patterns, and notes during the build process.\n`;
            await fs.writeFile(filePath, header + entry, 'utf-8');
        }

        console.log(`[LiftoffDirectory] Updated context.md`);
    }

    /**
     * Read full context
     */
    async readContext(): Promise<string> {
        try {
            const filePath = this.getFilePath('context');
            return await fs.readFile(filePath, 'utf-8');
        } catch {
            return '';
        }
    }

    /**
     * Update status snapshot
     */
    async updateStatus(status: LiftoffStatus): Promise<void> {
        const filePath = this.getFilePath('status');
        const content = JSON.stringify(status, null, 2);
        await fs.writeFile(filePath, content, 'utf-8');
        console.log(`[LiftoffDirectory] Updated status.json`);
    }

    /**
     * Load current status
     */
    async loadStatus(): Promise<LiftoffStatus | null> {
        try {
            const filePath = this.getFilePath('status');
            const content = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(content);
            parsed.lastUpdated = new Date(parsed.lastUpdated);
            return parsed;
        } catch {
            return null;
        }
    }

    /**
     * Get path to .liftoff directory
     */
    private getLiftoffPath(): string {
        return path.join(this.projectPath, this.LIFTOFF_DIR);
    }

    /**
     * Get path to specific file in .liftoff directory
     */
    private getFilePath(file: keyof typeof this.FILES): string {
        return path.join(this.getLiftoffPath(), this.FILES[file]);
    }

    /**
     * Get all file paths
     */
    getFilePaths(): Record<string, string> {
        return {
            plan: this.getFilePath('plan'),
            spec: this.getFilePath('spec'),
            architecture: this.getFilePath('architecture'),
            lessons: this.getFilePath('lessons'),
            context: this.getFilePath('context'),
            status: this.getFilePath('status')
        };
    }

    /**
     * Create initial context.md
     */
    async initializeContext(description: string, spec: AppSpec): Promise<void> {
        const content = `# Implementation Context

This file tracks key decisions, patterns, and notes during the build process.

## Project Overview

**Description:** ${description}

**Stack:**
- Frontend: ${spec.stack.frontend}
- Bundler: ${spec.stack.bundler}
- Styling: ${spec.stack.styling}
- Backend: ${spec.stack.backend}
- Database: ${spec.stack.database}
- Auth: ${spec.stack.auth}
- Hosting: ${spec.stack.hosting}

**Features:** ${spec.features.join(', ')}

**Entities:** ${spec.entities.map(e => e.name).join(', ')}

## Build Started
*${new Date().toISOString()}*
`;

        const filePath = this.getFilePath('context');
        await fs.writeFile(filePath, content, 'utf-8');
        console.log(`[LiftoffDirectory] Initialized context.md`);
    }

    /**
     * Create summary of directory contents (for agent context)
     */
    async getSummary(): Promise<string> {
        const files = this.getFilePaths();
        const summary: string[] = ['## .liftoff Directory Contents'];

        // Check which files exist
        for (const [name, filepath] of Object.entries(files)) {
            try {
                const stats = await fs.stat(filepath);
                const size = (stats.size / 1024).toFixed(1);
                summary.push(`- ${name}: ${filepath} (${size} KB)`);
            } catch {
                summary.push(`- ${name}: (not created yet)`);
            }
        }

        return summary.join('\n');
    }
}
