/**
 * Build State Manager - Persists and resumes build progress
 */

import * as fs from 'fs';
import * as path from 'path';
import { BuildState, BuildPhase } from './types';

const STATE_FILE_NAME = 'liftoff.state.json';

export class BuildStateManager {
    /**
     * Save build state to project directory
     */
    async saveState(projectPath: string, state: BuildState): Promise<void> {
        const statePath = path.join(projectPath, STATE_FILE_NAME);

        // Convert dates to ISO strings for JSON serialization
        const serializableState = {
            ...state,
            logs: state.logs.map(log => ({
                ...log,
                timestamp: log.timestamp.toISOString()
            }))
        };

        fs.writeFileSync(statePath, JSON.stringify(serializableState, null, 2), 'utf-8');
    }

    /**
     * Load build state from project directory
     */
    async loadState(projectPath: string): Promise<BuildState | null> {
        const statePath = path.join(projectPath, STATE_FILE_NAME);

        if (!fs.existsSync(statePath)) {
            return null;
        }

        try {
            const content = fs.readFileSync(statePath, 'utf-8');
            const parsed = JSON.parse(content);

            // Convert ISO strings back to dates
            const state: BuildState = {
                ...parsed,
                logs: parsed.logs.map((log: any) => ({
                    ...log,
                    timestamp: new Date(log.timestamp)
                }))
            };

            return state;
        } catch (error) {
            console.error('Failed to load build state:', error);
            return null;
        }
    }

    /**
     * Clear build state file
     */
    async clearState(projectPath: string): Promise<void> {
        const statePath = path.join(projectPath, STATE_FILE_NAME);

        if (fs.existsSync(statePath)) {
            fs.unlinkSync(statePath);
        }
    }

    /**
     * Check if a project has saved state
     */
    hasSavedState(projectPath: string): boolean {
        const statePath = path.join(projectPath, STATE_FILE_NAME);
        return fs.existsSync(statePath);
    }

    /**
     * Get phase progress percentage
     */
    getProgress(state: BuildState): number {
        const phases: BuildPhase[] = ['spec', 'architecture', 'scaffold', 'implement', 'test', 'deploy'];
        const currentIndex = phases.indexOf(state.phase);
        return Math.round((currentIndex / phases.length) * 100);
    }

    /**
     * Get human-readable phase name
     */
    getPhaseName(phase: BuildPhase): string {
        const names: Record<BuildPhase, string> = {
            spec: 'Specification',
            architecture: 'Architecture Design',
            scaffold: 'Project Setup',
            implement: 'Building Features',
            test: 'Testing',
            deploy: 'Deployment'
        };
        return names[phase];
    }

    /**
     * Export build state as markdown report
     */
    exportReport(state: BuildState): string {
        const lines: string[] = [];

        lines.push('# Liftoff Build Report');
        lines.push('');
        lines.push(`**Current Phase:** ${this.getPhaseName(state.phase)}`);
        lines.push(`**Progress:** ${this.getProgress(state)}%`);
        lines.push('');

        if (state.spec) {
            lines.push('## Specification');
            lines.push(`- **Name:** ${state.spec.name}`);
            lines.push(`- **Type:** ${state.spec.type}`);
            lines.push(`- **Features:** ${state.spec.features.join(', ')}`);
            lines.push('');
        }

        if (state.architecture) {
            lines.push('## Architecture');
            lines.push(`- **Tables:** ${state.architecture.database.tables.length}`);
            lines.push(`- **Components:** ${state.architecture.components.pages.length} pages`);
            lines.push(`- **API Routes:** ${state.architecture.apiRoutes.length}`);
            lines.push('');
        }

        if (state.completedFeatures.length > 0) {
            lines.push('## Completed Features');
            state.completedFeatures.forEach(f => lines.push(`- [x] ${f}`));
            lines.push('');
        }

        if (state.failedFeatures.length > 0) {
            lines.push('## Failed Features');
            state.failedFeatures.forEach(f => lines.push(`- [ ] ${f}`));
            lines.push('');
        }

        if (state.todoItems.length > 0) {
            lines.push('## TODO Items');
            state.todoItems.forEach(t => lines.push(`- [ ] ${t}`));
            lines.push('');
        }

        if (state.logs.length > 0) {
            lines.push('## Build Log');
            lines.push('');
            lines.push('| Time | Phase | Action | Status |');
            lines.push('|------|-------|--------|--------|');

            for (const log of state.logs.slice(-20)) { // Last 20 entries
                const time = log.timestamp.toLocaleTimeString();
                lines.push(`| ${time} | ${log.phase} | ${log.action} | ${log.status} |`);
            }
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Create initial build state
     */
    createInitialState(): BuildState {
        return {
            phase: 'spec',
            completedFeatures: [],
            failedFeatures: [],
            todoItems: [],
            logs: []
        };
    }

    /**
     * Update state with completed feature
     */
    markFeatureComplete(state: BuildState, feature: string): BuildState {
        return {
            ...state,
            completedFeatures: [...state.completedFeatures, feature as any]
        };
    }

    /**
     * Update state with failed feature
     */
    markFeatureFailed(state: BuildState, feature: string): BuildState {
        return {
            ...state,
            failedFeatures: [...state.failedFeatures, feature as any]
        };
    }

    /**
     * Add log entry
     */
    addLog(state: BuildState, action: string, status: 'started' | 'completed' | 'failed' | 'skipped'): BuildState {
        return {
            ...state,
            logs: [...state.logs, {
                timestamp: new Date(),
                phase: state.phase,
                action,
                status
            }]
        };
    }
}

/**
 * Convenience functions for state management
 */
export async function saveBuildState(projectPath: string, state: BuildState): Promise<void> {
    const manager = new BuildStateManager();
    await manager.saveState(projectPath, state);
}

export async function loadBuildState(projectPath: string): Promise<BuildState | null> {
    const manager = new BuildStateManager();
    return manager.loadState(projectPath);
}

export function hasBuildState(projectPath: string): boolean {
    const manager = new BuildStateManager();
    return manager.hasSavedState(projectPath);
}
