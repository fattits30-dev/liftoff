/**
 * Retry Analyzer
 * Intelligent retry strategy selection based on failure patterns
 */

import { AgentType } from '../core/interfaces/IAgentRunner';
import {
    RetryStrategy,
    RetryDecision,
    FailedAttempt,
    TaskDecomposition,
    AGENT_CAPABILITIES,
} from '../types/collaboration';

/**
 * Error patterns and their recommended strategies
 */
interface ErrorPattern {
    pattern: RegExp;
    strategy: RetryStrategy;
    targetAgent?: AgentType;
    confidence: number;
    reason: string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
    // Tool/capability errors -> different agent
    {
        pattern: /unknown tool|tool not found|no such command/i,
        strategy: 'different_agent',
        confidence: 0.8,
        reason: 'Agent lacks required tool',
    },
    {
        pattern: /permission denied|access denied|forbidden/i,
        strategy: 'escalate',
        confidence: 0.9,
        reason: 'Permission issue requires user intervention',
    },

    // Syntax/code errors -> same agent different approach
    {
        pattern: /syntax error|parse error|unexpected token/i,
        strategy: 'same_agent_different',
        confidence: 0.7,
        reason: 'Syntax error suggests code generation issue',
    },
    {
        pattern: /type error|cannot read property|undefined is not/i,
        strategy: 'same_agent_different',
        confidence: 0.7,
        reason: 'Type error suggests approach needs adjustment',
    },

    // Test failures -> testing agent
    {
        pattern: /test failed|assertion error|expect.*received/i,
        strategy: 'different_agent',
        targetAgent: 'testing',
        confidence: 0.85,
        reason: 'Test failure requires testing expertise',
    },

    // Build/compile errors -> depends on type
    {
        pattern: /build failed|compilation error|module not found/i,
        strategy: 'same_agent_different',
        confidence: 0.6,
        reason: 'Build error may need dependency or config fix',
    },

    // Timeout/resource errors -> spawn helper
    {
        pattern: /timeout|timed out|too long|memory exceeded/i,
        strategy: 'decompose',
        confidence: 0.75,
        reason: 'Task may be too complex, needs decomposition',
    },

    // Network/API errors -> retry
    {
        pattern: /network error|connection refused|econnreset|socket hang up/i,
        strategy: 'same_agent',
        confidence: 0.8,
        reason: 'Transient network error, retry may succeed',
    },

    // Database errors -> database agent
    {
        pattern: /sql error|database error|migration failed|query failed/i,
        strategy: 'different_agent',
        targetAgent: 'database',
        confidence: 0.85,
        reason: 'Database issue requires database expertise',
    },

    // Deployment errors -> devops agent
    {
        pattern: /deploy failed|docker error|container error|kubernetes/i,
        strategy: 'different_agent',
        targetAgent: 'devops',
        confidence: 0.85,
        reason: 'Deployment issue requires DevOps expertise',
    },

    // UI/styling errors -> frontend agent
    {
        pattern: /css error|style error|layout issue|responsive|component/i,
        strategy: 'different_agent',
        targetAgent: 'frontend',
        confidence: 0.8,
        reason: 'UI issue requires frontend expertise',
    },

    // API/backend errors -> backend agent
    {
        pattern: /api error|endpoint error|route not found|authentication/i,
        strategy: 'different_agent',
        targetAgent: 'backend',
        confidence: 0.8,
        reason: 'API issue requires backend expertise',
    },
];

/**
 * Agent transition preferences (from -> to)
 */
const AGENT_TRANSITIONS: Record<AgentType, AgentType[]> = {
    frontend: ['backend', 'testing', 'general'],
    backend: ['frontend', 'database', 'testing', 'devops'],
    testing: ['frontend', 'backend', 'general'],
    browser: ['frontend', 'testing', 'general'],
    devops: ['backend', 'general'],
    database: ['backend', 'devops', 'general'],
    general: ['frontend', 'backend', 'testing', 'devops'],
    cleaner: ['general', 'frontend', 'backend'],
};

export class RetryAnalyzer {
    private readonly maxSameAgentRetries = 2;
    private readonly maxTotalRetries = 5;

    /**
     * Analyze failure and decide on retry strategy
     */
    analyze(
        failedAgentType: AgentType,
        error: string,
        attempts: FailedAttempt[]
    ): RetryDecision {
        // Count retries by type
        const sameAgentAttempts = attempts.filter(
            (a) => a.agentType === failedAgentType
        ).length;
        const totalAttempts = attempts.length;

        // If exceeded max total retries, escalate
        if (totalAttempts >= this.maxTotalRetries) {
            return {
                strategy: 'escalate',
                reason: `Exceeded maximum ${this.maxTotalRetries} retry attempts`,
                confidence: 0.95,
            };
        }

        // Match error against patterns
        for (const pattern of ERROR_PATTERNS) {
            if (pattern.pattern.test(error)) {
                // Don't switch to same agent type
                if (pattern.targetAgent === failedAgentType) {
                    continue;
                }

                // Determine target agent
                let targetAgent = pattern.targetAgent;
                if (pattern.strategy === 'different_agent' && !targetAgent) {
                    targetAgent = this.findBestAlternativeAgent(
                        failedAgentType,
                        error,
                        attempts
                    );
                }

                return {
                    strategy: pattern.strategy,
                    targetAgent,
                    reason: pattern.reason,
                    confidence: pattern.confidence,
                    modifiedPrompt: this.generateModifiedPrompt(error, pattern.strategy),
                };
            }
        }

        // No pattern matched - use heuristics
        if (sameAgentAttempts < this.maxSameAgentRetries) {
            return {
                strategy: 'same_agent_different',
                reason: 'No specific pattern matched, trying different approach',
                confidence: 0.5,
                modifiedPrompt: this.generateDifferentApproachPrompt(error, attempts),
            };
        }

        // Too many same-agent retries, try different agent
        const alternativeAgent = this.findBestAlternativeAgent(
            failedAgentType,
            error,
            attempts
        );

        if (alternativeAgent) {
            return {
                strategy: 'different_agent',
                targetAgent: alternativeAgent,
                reason: `${failedAgentType} agent failed ${sameAgentAttempts} times, trying ${alternativeAgent}`,
                confidence: 0.6,
            };
        }

        // Check if task should be decomposed
        if (this.shouldDecompose(attempts)) {
            return {
                strategy: 'decompose',
                reason: 'Multiple failures suggest task is too complex',
                confidence: 0.7,
            };
        }

        // Last resort: escalate
        return {
            strategy: 'escalate',
            reason: 'Unable to determine suitable retry strategy',
            confidence: 0.4,
        };
    }

    /**
     * Find the best alternative agent based on error and history
     */
    private findBestAlternativeAgent(
        currentAgent: AgentType,
        error: string,
        attempts: FailedAttempt[]
    ): AgentType | undefined {
        // Get preferred transitions
        const preferredAgents = AGENT_TRANSITIONS[currentAgent] || [];

        // Filter out already-failed agents
        const failedAgentTypes = new Set(attempts.map((a) => a.agentType));

        // Score each candidate
        const candidates = preferredAgents
            .filter((agent) => !failedAgentTypes.has(agent))
            .map((agent) => ({
                agent,
                score: this.scoreAgentForError(agent, error),
            }))
            .sort((a, b) => b.score - a.score);

        return candidates[0]?.agent;
    }

    /**
     * Score how well an agent matches an error
     */
    private scoreAgentForError(agent: AgentType, error: string): number {
        const capability = AGENT_CAPABILITIES.find((c) => c.agentType === agent);
        if (!capability) return 0;

        let score = capability.priority;

        // Check if error mentions skills this agent has
        for (const skill of capability.skills) {
            if (error.toLowerCase().includes(skill)) {
                score += 20;
            }
        }

        return score;
    }

    /**
     * Check if task should be decomposed
     */
    private shouldDecompose(attempts: FailedAttempt[]): boolean {
        if (attempts.length < 2) return false;

        // Check for complexity indicators
        const hasTimeout = attempts.some((a) => a.error.toLowerCase().includes('timeout'));
        const hasMemory = attempts.some((a) =>
            a.error.toLowerCase().includes('memory') || a.error.toLowerCase().includes('heap')
        );
        const hasMultipleSteps = attempts.some(
            (a) =>
                a.error.toLowerCase().includes('step') ||
                a.error.toLowerCase().includes('multiple')
        );

        // High iteration count suggests complexity
        const avgIterations =
            attempts.reduce((sum, a) => sum + a.iterationsUsed, 0) / attempts.length;
        const highIterations = avgIterations > 30;

        return hasTimeout || hasMemory || hasMultipleSteps || highIterations;
    }

    /**
     * Generate a modified prompt for retry
     */
    private generateModifiedPrompt(error: string, strategy: RetryStrategy): string | undefined {
        switch (strategy) {
            case 'same_agent_different':
                return `Previous attempt failed with: ${error}\n\nPlease try a DIFFERENT approach. Consider:\n- Breaking the task into smaller steps\n- Using alternative methods\n- Verifying preconditions before proceeding`;

            case 'decompose':
                return `This task appears too complex. Please break it down into smaller, independent subtasks that can be completed separately.`;

            default:
                return undefined;
        }
    }

    /**
     * Generate prompt for different approach
     */
    private generateDifferentApproachPrompt(
        error: string,
        attempts: FailedAttempt[]
    ): string {
        const previousApproaches = attempts
            .map((a) => `- ${a.toolsAttempted.join(', ')}`)
            .join('\n');

        return `Previous attempts failed:
Error: ${error}

Previously tried tools:
${previousApproaches}

Please try a COMPLETELY DIFFERENT approach. Avoid using the same tools in the same way.
Consider:
1. Alternative tools that accomplish the same goal
2. Manual steps instead of automated ones
3. Verifying the current state before making changes`;
    }

    /**
     * Decompose a complex task into subtasks
     */
    decomposeTask(task: string, context?: string): TaskDecomposition {
        // Simple heuristic-based decomposition
        const subtasks: TaskDecomposition['subtasks'] = [];

        // Common patterns for decomposition
        const patterns = [
            { pattern: /create.*and.*test/i, split: ['create', 'test'] },
            { pattern: /build.*and.*deploy/i, split: ['build', 'deploy'] },
            { pattern: /implement.*and.*integrate/i, split: ['implement', 'integrate'] },
            { pattern: /setup.*configure.*and.*run/i, split: ['setup', 'configure', 'run'] },
        ];

        for (const { pattern, split } of patterns) {
            if (pattern.test(task)) {
                // Found a pattern, create subtasks
                for (let i = 0; i < split.length; i++) {
                    const keyword = split[i];
                    const agentType = this.inferAgentForKeyword(keyword);

                    subtasks.push({
                        task: `${keyword} - ${task.match(new RegExp(`${keyword}[^,]*`, 'i'))?.[0] || keyword}`,
                        agentType,
                        priority: split.length - i,
                        dependencies: i > 0 ? [i - 1] : [],
                    });
                }
                break;
            }
        }

        // If no pattern matched, create generic subtasks
        if (subtasks.length === 0) {
            subtasks.push(
                {
                    task: `Analyze and plan: ${task}`,
                    agentType: 'general',
                    priority: 3,
                    dependencies: [],
                },
                {
                    task: `Implement: ${task}`,
                    agentType: this.inferAgentForTask(task),
                    priority: 2,
                    dependencies: [0],
                },
                {
                    task: `Verify: ${task}`,
                    agentType: 'testing',
                    priority: 1,
                    dependencies: [1],
                }
            );
        }

        return {
            originalTask: task,
            subtasks,
            estimatedComplexity: subtasks.length > 3 ? 'high' : subtasks.length > 1 ? 'medium' : 'low',
        };
    }

    /**
     * Infer agent type from keyword
     */
    private inferAgentForKeyword(keyword: string): AgentType {
        const keywordMap: Record<string, AgentType> = {
            create: 'general',
            build: 'backend',
            test: 'testing',
            deploy: 'devops',
            setup: 'devops',
            configure: 'backend',
            implement: 'backend',
            integrate: 'backend',
            style: 'frontend',
            design: 'frontend',
            run: 'general',
        };

        return keywordMap[keyword.toLowerCase()] || 'general';
    }

    /**
     * Infer agent type from task description
     */
    private inferAgentForTask(task: string): AgentType {
        const taskLower = task.toLowerCase();

        if (taskLower.includes('ui') || taskLower.includes('component') || taskLower.includes('style')) {
            return 'frontend';
        }
        if (taskLower.includes('api') || taskLower.includes('endpoint') || taskLower.includes('server')) {
            return 'backend';
        }
        if (taskLower.includes('test') || taskLower.includes('verify')) {
            return 'testing';
        }
        if (taskLower.includes('deploy') || taskLower.includes('docker') || taskLower.includes('ci')) {
            return 'devops';
        }
        if (taskLower.includes('database') || taskLower.includes('sql') || taskLower.includes('migration')) {
            return 'database';
        }

        return 'general';
    }
}
