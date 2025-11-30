/**
 * Loop Detector - Intelligent detection of stuck agents
 *
 * Detects patterns that indicate an agent is stuck in a loop:
 * - Repeating the same tool calls
 * - Repeating the same errors
 * - Making no progress toward the goal
 *
 * When a loop is detected, suggests the agent be handed back to orchestrator
 * for a different approach.
 */

export interface ToolExecution {
    name: string;
    params: any;
    result: { success: boolean; output?: string; error?: string };
    timestamp: number;
}

export interface LoopDetectionResult {
    isStuck: boolean;
    reason?: string;
    evidence?: string[];
    suggestion?: string;
}

export class LoopDetector {
    private toolHistory: Map<string, ToolExecution[]> = new Map();
    private errorHistory: Map<string, string[]> = new Map();

    // Configuration
    private readonly TOOL_REPEAT_THRESHOLD = 3;  // Same tool+params repeated 3 times
    private readonly ERROR_REPEAT_THRESHOLD = 3;  // Same error 3 times
    private readonly WINDOW_SIZE = 10;  // Look at last 10 tool executions
    private readonly ERROR_WINDOW_SIZE = 5;  // Look at last 5 errors

    /**
     * Record a tool execution for analysis
     */
    recordToolExecution(agentId: string, execution: ToolExecution): void {
        if (!this.toolHistory.has(agentId)) {
            this.toolHistory.set(agentId, []);
        }

        const history = this.toolHistory.get(agentId)!;
        history.push(execution);

        // Keep only recent history
        if (history.length > this.WINDOW_SIZE * 2) {
            this.toolHistory.set(agentId, history.slice(-this.WINDOW_SIZE * 2));
        }
    }

    /**
     * Record an error for pattern detection
     */
    recordError(agentId: string, error: string): void {
        if (!this.errorHistory.has(agentId)) {
            this.errorHistory.set(agentId, []);
        }

        const history = this.errorHistory.get(agentId)!;
        history.push(error);

        // Keep only recent errors
        if (history.length > this.ERROR_WINDOW_SIZE * 2) {
            this.errorHistory.set(agentId, history.slice(-this.ERROR_WINDOW_SIZE * 2));
        }
    }

    /**
     * Check if agent is stuck in a loop
     */
    detectLoop(agentId: string): LoopDetectionResult {
        // Check for repeating tool calls
        const toolLoopResult = this.detectToolLoop(agentId);
        if (toolLoopResult.isStuck) {
            return toolLoopResult;
        }

        // Check for repeating errors
        const errorLoopResult = this.detectErrorLoop(agentId);
        if (errorLoopResult.isStuck) {
            return errorLoopResult;
        }

        // Check for thrashing (alternating between same few actions)
        const thrashingResult = this.detectThrashing(agentId);
        if (thrashingResult.isStuck) {
            return thrashingResult;
        }

        return { isStuck: false };
    }

    /**
     * Detect if agent is repeating the same tool with same params
     */
    private detectToolLoop(agentId: string): LoopDetectionResult {
        const history = this.toolHistory.get(agentId);
        if (!history || history.length < this.TOOL_REPEAT_THRESHOLD) {
            return { isStuck: false };
        }

        const recentTools = history.slice(-this.WINDOW_SIZE);
        const toolSignatures = new Map<string, number>();

        for (const exec of recentTools) {
            // Create signature: tool name + stringified params
            const signature = `${exec.name}:${JSON.stringify(exec.params)}`;
            toolSignatures.set(signature, (toolSignatures.get(signature) || 0) + 1);
        }

        // Check if any tool+params combo repeats too many times
        for (const [signature, count] of toolSignatures.entries()) {
            if (count >= this.TOOL_REPEAT_THRESHOLD) {
                const [toolName, params] = signature.split(':');
                return {
                    isStuck: true,
                    reason: 'Repeating same tool call',
                    evidence: [
                        `Tool "${toolName}" called ${count} times with identical parameters`,
                        `Last ${this.WINDOW_SIZE} executions show no variation`,
                    ],
                    suggestion: 'Try a different approach or break down the task differently'
                };
            }
        }

        return { isStuck: false };
    }

    /**
     * Detect if agent is getting the same error repeatedly
     */
    private detectErrorLoop(agentId: string): LoopDetectionResult {
        const errors = this.errorHistory.get(agentId);
        if (!errors || errors.length < this.ERROR_REPEAT_THRESHOLD) {
            return { isStuck: false };
        }

        const recentErrors = errors.slice(-this.ERROR_WINDOW_SIZE);
        const errorCounts = new Map<string, number>();

        for (const error of recentErrors) {
            // Normalize error (first 100 chars for pattern matching)
            const normalized = error.substring(0, 100).toLowerCase();
            errorCounts.set(normalized, (errorCounts.get(normalized) || 0) + 1);
        }

        for (const [error, count] of errorCounts.entries()) {
            if (count >= this.ERROR_REPEAT_THRESHOLD) {
                return {
                    isStuck: true,
                    reason: 'Repeating same error',
                    evidence: [
                        `Same error occurred ${count} times in last ${this.ERROR_WINDOW_SIZE} failures`,
                        `Error pattern: ${error}...`,
                    ],
                    suggestion: 'Agent may need different tools or permissions to proceed'
                };
            }
        }

        return { isStuck: false };
    }

    /**
     * Detect thrashing - alternating between same 2-3 actions
     */
    private detectThrashing(agentId: string): LoopDetectionResult {
        const history = this.toolHistory.get(agentId);
        if (!history || history.length < 6) {
            return { isStuck: false };
        }

        const recent = history.slice(-8);
        const toolNames = recent.map(exec => exec.name);

        // Check for ABAB or ABCABC patterns
        const uniqueTools = new Set(toolNames);
        if (uniqueTools.size <= 3 && toolNames.length >= 6) {
            // Check if it's a repeating pattern
            const halfLength = Math.floor(toolNames.length / 2);
            const firstHalf = toolNames.slice(0, halfLength).join(',');
            const secondHalf = toolNames.slice(halfLength, halfLength * 2).join(',');

            if (firstHalf === secondHalf) {
                return {
                    isStuck: true,
                    reason: 'Thrashing between same actions',
                    evidence: [
                        `Alternating between ${uniqueTools.size} tools: ${Array.from(uniqueTools).join(', ')}`,
                        `Pattern detected: ${firstHalf}`,
                    ],
                    suggestion: 'Agent needs to try a fundamentally different strategy'
                };
            }
        }

        return { isStuck: false };
    }

    /**
     * Clear history for an agent (e.g., when restarting with new approach)
     */
    clearAgent(agentId: string): void {
        this.toolHistory.delete(agentId);
        this.errorHistory.delete(agentId);
    }

    /**
     * Get statistics for debugging
     */
    getStats(agentId: string): {
        toolExecutions: number;
        errors: number;
        uniqueTools: number;
        recentTools: string[];
    } {
        const tools = this.toolHistory.get(agentId) || [];
        const errors = this.errorHistory.get(agentId) || [];
        const uniqueTools = new Set(tools.map(t => t.name));

        return {
            toolExecutions: tools.length,
            errors: errors.length,
            uniqueTools: uniqueTools.size,
            recentTools: tools.slice(-5).map(t => t.name)
        };
    }
}
