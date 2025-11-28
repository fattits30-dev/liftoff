/**
 * Hybrid Router - Cloud brain for orchestration, local muscle for heavy lifting
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    HYBRID AGENT ARCHITECTURE                │
 * ├─────────────────────────────────────────────────────────────┤
 * │  ☁️  CLOUD ORCHESTRATOR (HuggingFace Inference API)         │
 * │  • Task planning & decomposition                            │
 * │  • Tool selection decisions                                 │
 * │  • Quick-fire responses (chat, simple queries)              │
 * │                          │                                  │
 * │                          ▼                                  │
 * │  ┌─────────────────────────────────────────────────────┐   │
 * │  │              TASK ROUTER / DISPATCHER               │   │
 * │  │  "Is this quick-fire or heavy lifting?"             │   │
 * │  └─────────────────────────────────────────────────────┘   │
 * │            │                              │                 │
 * │  ┌──────────────────┐          ┌──────────────────────┐    │
 * │  │  QUICK-FIRE      │          │  HEAVY JOBS          │    │
 * │  │  (Stay on Cloud) │          │  (Route to Local)    │    │
 * │  └──────────────────┘          └──────────────────────┘    │
 * │                                           │                 │
 * │  🏠 LOCAL WORKER (Ollama)                                   │
 * │  • Bulk code generation                                     │
 * │  • Deep file analysis                                       │
 * │  • Multi-file refactoring                                   │
 * └─────────────────────────────────────────────────────────────┘
 */

import { HuggingFaceProvider, HFMessage } from '../hfProvider';
import { OllamaProvider, OllamaMessage } from './ollama';

export type TaskType = 'quick' | 'heavy';
export type ExecutionTarget = 'cloud' | 'local' | 'auto';

export interface TaskClassification {
    type: TaskType;
    confidence: number;
    reason: string;
    estimatedTokens: number;
    subtasks?: string[];
}

export interface HybridConfig {
    // Cloud settings
    cloudModel: string;
    cloudApiKey?: string;

    // Local settings
    localModel: string;
    ollamaUrl: string;
    localContextLength: number;

    // Routing settings
    preferLocal: boolean;              // Prefer local when possible
    cloudRateLimit: number;            // Max cloud calls per hour
    heavyTokenThreshold: number;       // Tokens above this = heavy task
    forceLocalPatterns: RegExp[];      // Patterns that always go local
    forceCloudPatterns: RegExp[];      // Patterns that always go cloud
}

export interface RoutingStats {
    cloudCallsThisHour: number;
    localCallsThisHour: number;
    cloudTokensUsed: number;
    localTokensUsed: number;
    averageCloudLatency: number;
    averageLocalLatency: number;
    lastHourReset: number;
}

const DEFAULT_CONFIG: HybridConfig = {
    cloudModel: 'Qwen/Qwen3-Coder-30B-A3B-Instruct',
    localModel: 'devstral:latest',
    ollamaUrl: 'http://localhost:11434',
    localContextLength: 8192,
    preferLocal: true,
    cloudRateLimit: 100,
    heavyTokenThreshold: 2000,
    forceLocalPatterns: [
        /generate.*code/i,
        /create.*function/i,
        /implement/i,
        /refactor/i,
        /write.*test/i,
        /analyze.*file/i,
        /review.*code/i,
    ],
    forceCloudPatterns: [
        /^what\s+(is|are)/i,
        /^how\s+do/i,
        /^explain/i,
        /^summarize/i,
    ],
};

// Keywords that indicate heavy lifting
const HEAVY_KEYWORDS = [
    'generate', 'create', 'write', 'implement', 'build', 'develop',
    'refactor', 'rewrite', 'restructure', 'redesign',
    'analyze', 'review', 'audit', 'examine', 'inspect',
    'test', 'debug', 'fix', 'patch', 'update',
    'document', 'annotate', 'comment',
    'optimize', 'improve', 'enhance',
    'convert', 'migrate', 'port', 'transform',
];

// File extensions that indicate code work
const CODE_EXTENSIONS = [
    '.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.cpp', '.c', '.h',
    '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala',
    '.vue', '.svelte', '.html', '.css', '.scss', '.sql',
];

export class HybridRouter {
    private cloudProvider: HuggingFaceProvider | null = null;
    private localProvider: OllamaProvider;
    private config: HybridConfig;
    private stats: RoutingStats;
    private localAvailable: boolean = false;

    constructor(config?: Partial<HybridConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.localProvider = new OllamaProvider({
            baseUrl: this.config.ollamaUrl,
            model: this.config.localModel,
            contextLength: this.config.localContextLength,
        });

        this.stats = {
            cloudCallsThisHour: 0,
            localCallsThisHour: 0,
            cloudTokensUsed: 0,
            localTokensUsed: 0,
            averageCloudLatency: 0,
            averageLocalLatency: 0,
            lastHourReset: Date.now(),
        };
    }

    /**
     * Initialize providers
     */
    async initialize(cloudApiKey?: string): Promise<{ cloud: boolean; local: boolean }> {
        // Initialize cloud
        if (cloudApiKey || this.config.cloudApiKey) {
            this.cloudProvider = new HuggingFaceProvider(cloudApiKey || this.config.cloudApiKey!);
        }

        // Check local availability
        this.localAvailable = await this.localProvider.isAvailable();

        return {
            cloud: this.cloudProvider !== null,
            local: this.localAvailable,
        };
    }

    /**
     * Classify a task as quick or heavy
     */
    classifyTask(task: string, context?: string): TaskClassification {
        const taskLower = task.toLowerCase();
        const fullText = context ? `${task} ${context}` : task;

        // Check force patterns first
        for (const pattern of this.config.forceCloudPatterns) {
            if (pattern.test(task)) {
                return {
                    type: 'quick',
                    confidence: 0.95,
                    reason: 'Matched cloud-preferred pattern',
                    estimatedTokens: this.estimateTokens(task),
                };
            }
        }

        for (const pattern of this.config.forceLocalPatterns) {
            if (pattern.test(task)) {
                return {
                    type: 'heavy',
                    confidence: 0.95,
                    reason: 'Matched local-preferred pattern',
                    estimatedTokens: this.estimateTokens(fullText),
                };
            }
        }

        // Count heavy keywords
        const heavyKeywordCount = HEAVY_KEYWORDS.filter(kw => taskLower.includes(kw)).length;

        // Check for code-related content
        const hasCodeBlock = fullText.includes('```');
        const hasCodeExtension = CODE_EXTENSIONS.some(ext => fullText.includes(ext));
        const hasMultipleFiles = (fullText.match(/\.(py|js|ts|tsx|java|cpp|go|rs)/g) || []).length > 1;

        // Estimate tokens
        const estimatedTokens = this.estimateTokens(fullText);

        // Scoring
        let heavyScore = 0;

        if (heavyKeywordCount >= 3) heavyScore += 3;
        else if (heavyKeywordCount >= 2) heavyScore += 2;
        else if (heavyKeywordCount >= 1) heavyScore += 1;

        if (hasCodeBlock) heavyScore += 2;
        if (hasCodeExtension) heavyScore += 1;
        if (hasMultipleFiles) heavyScore += 2;
        if (estimatedTokens > this.config.heavyTokenThreshold) heavyScore += 2;
        if (task.length > 500) heavyScore += 1;

        const isHeavy = heavyScore >= 3;
        const confidence = Math.min(0.95, 0.5 + (heavyScore * 0.1));

        let reason = '';
        if (isHeavy) {
            const reasons: string[] = [];
            if (heavyKeywordCount > 0) reasons.push(`${heavyKeywordCount} heavy keywords`);
            if (hasCodeBlock) reasons.push('code blocks');
            if (hasMultipleFiles) reasons.push('multiple files');
            if (estimatedTokens > this.config.heavyTokenThreshold) reasons.push('high token count');
            reason = `Heavy task: ${reasons.join(', ')}`;
        } else {
            reason = 'Quick task: simple query or low complexity';
        }

        return {
            type: isHeavy ? 'heavy' : 'quick',
            confidence,
            reason,
            estimatedTokens,
        };
    }

    /**
     * Estimate token count (rough approximation)
     */
    private estimateTokens(text: string): number {
        // Rough estimate: ~4 chars per token for English, ~2.5 for code
        const hasCode = text.includes('```') || CODE_EXTENSIONS.some(ext => text.includes(ext));
        const charsPerToken = hasCode ? 2.5 : 4;
        return Math.ceil(text.length / charsPerToken);
    }

    /**
     * Decide execution target based on task and current state
     */
    decideTarget(classification: TaskClassification, forcedTarget?: ExecutionTarget): ExecutionTarget {
        // If forced, use that (unless not available)
        if (forcedTarget && forcedTarget !== 'auto') {
            if (forcedTarget === 'local' && !this.localAvailable) {
                return 'cloud';
            }
            if (forcedTarget === 'cloud' && !this.cloudProvider) {
                return this.localAvailable ? 'local' : 'cloud';
            }
            return forcedTarget;
        }

        // Reset hourly stats if needed
        this.maybeResetHourlyStats();

        // Check rate limits
        if (this.stats.cloudCallsThisHour >= this.config.cloudRateLimit) {
            if (this.localAvailable) {
                return 'local';
            }
            // If local not available, we have to use cloud anyway
        }

        // Heavy tasks prefer local
        if (classification.type === 'heavy') {
            if (this.localAvailable) {
                return 'local';
            }
            return 'cloud';
        }

        // Quick tasks prefer cloud (faster network vs local inference)
        if (classification.type === 'quick') {
            if (this.cloudProvider) {
                return 'cloud';
            }
            return this.localAvailable ? 'local' : 'cloud';
        }

        // Default: prefer local if available and configured
        if (this.config.preferLocal && this.localAvailable) {
            return 'local';
        }

        return 'cloud';
    }

    /**
     * Execute on cloud
     */
    async executeCloud(
        messages: HFMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<string> {
        if (!this.cloudProvider) {
            throw new Error('Cloud provider not initialized');
        }

        const startTime = Date.now();

        let result = '';
        for await (const chunk of this.cloudProvider.streamChat(
            this.config.cloudModel,
            messages,
            options
        )) {
            result += chunk;
        }

        // Update stats
        const latency = Date.now() - startTime;
        this.stats.cloudCallsThisHour++;
        this.stats.cloudTokensUsed += this.estimateTokens(result);
        this.stats.averageCloudLatency = (this.stats.averageCloudLatency + latency) / 2;

        return result;
    }

    /**
     * Execute on cloud (streaming)
     */
    async *streamCloud(
        messages: HFMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): AsyncGenerator<string, void, unknown> {
        if (!this.cloudProvider) {
            throw new Error('Cloud provider not initialized');
        }

        const startTime = Date.now();
        let totalChunks = '';

        for await (const chunk of this.cloudProvider.streamChat(
            this.config.cloudModel,
            messages,
            options
        )) {
            totalChunks += chunk;
            yield chunk;
        }

        // Update stats
        const latency = Date.now() - startTime;
        this.stats.cloudCallsThisHour++;
        this.stats.cloudTokensUsed += this.estimateTokens(totalChunks);
        this.stats.averageCloudLatency = (this.stats.averageCloudLatency + latency) / 2;
    }

    /**
     * Execute on local
     */
    async executeLocal(
        messages: OllamaMessage[],
        options?: { temperature?: number; numCtx?: number }
    ): Promise<string> {
        if (!this.localAvailable) {
            throw new Error('Local provider not available');
        }

        const startTime = Date.now();
        const result = await this.localProvider.chat(messages, options);

        // Update stats
        const latency = Date.now() - startTime;
        this.stats.localCallsThisHour++;
        this.stats.localTokensUsed += this.estimateTokens(result);
        this.stats.averageLocalLatency = (this.stats.averageLocalLatency + latency) / 2;

        return result;
    }

    /**
     * Execute on local (streaming)
     */
    async *streamLocal(
        messages: OllamaMessage[],
        options?: { temperature?: number; numCtx?: number }
    ): AsyncGenerator<string, void, unknown> {
        if (!this.localAvailable) {
            throw new Error('Local provider not available');
        }

        const startTime = Date.now();
        let totalChunks = '';

        for await (const chunk of this.localProvider.streamChat(messages, options)) {
            totalChunks += chunk;
            yield chunk;
        }

        // Update stats
        const latency = Date.now() - startTime;
        this.stats.localCallsThisHour++;
        this.stats.localTokensUsed += this.estimateTokens(totalChunks);
        this.stats.averageLocalLatency = (this.stats.averageLocalLatency + latency) / 2;
    }

    /**
     * Smart execute - automatically routes to cloud or local
     */
    async execute(
        task: string,
        systemPrompt: string,
        context?: string,
        forcedTarget?: ExecutionTarget
    ): Promise<{ result: string; target: ExecutionTarget; classification: TaskClassification }> {
        const classification = this.classifyTask(task, context);
        const target = this.decideTarget(classification, forcedTarget);

        const messages: HFMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: context ? `${task}\n\nContext:\n${context}` : task }
        ];

        let result: string;

        if (target === 'local') {
            result = await this.executeLocal(messages as OllamaMessage[]);
        } else {
            result = await this.executeCloud(messages);
        }

        return { result, target, classification };
    }

    /**
     * Smart execute (streaming) - automatically routes to cloud or local
     */
    async *stream(
        task: string,
        systemPrompt: string,
        context?: string,
        forcedTarget?: ExecutionTarget
    ): AsyncGenerator<{ chunk: string; target: ExecutionTarget; classification: TaskClassification }, void, unknown> {
        const classification = this.classifyTask(task, context);
        const target = this.decideTarget(classification, forcedTarget);

        const messages: HFMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: context ? `${task}\n\nContext:\n${context}` : task }
        ];

        if (target === 'local') {
            for await (const chunk of this.streamLocal(messages as OllamaMessage[])) {
                yield { chunk, target, classification };
            }
        } else {
            for await (const chunk of this.streamCloud(messages)) {
                yield { chunk, target, classification };
            }
        }
    }

    /**
     * Reset hourly stats if an hour has passed
     */
    private maybeResetHourlyStats(): void {
        const now = Date.now();
        if (now - this.stats.lastHourReset >= 3600000) { // 1 hour
            this.stats.cloudCallsThisHour = 0;
            this.stats.localCallsThisHour = 0;
            this.stats.lastHourReset = now;
        }
    }

    /**
     * Get current stats
     */
    getStats(): RoutingStats {
        this.maybeResetHourlyStats();
        return { ...this.stats };
    }

    /**
     * Get provider availability
     */
    getAvailability(): { cloud: boolean; local: boolean } {
        return {
            cloud: this.cloudProvider !== null,
            local: this.localAvailable,
        };
    }

    /**
     * Set local model
     */
    setLocalModel(model: string): void {
        this.config.localModel = model;
        this.localProvider.setModel(model);
    }

    /**
     * Set cloud model
     */
    setCloudModel(model: string): void {
        this.config.cloudModel = model;
    }

    /**
     * Refresh local availability
     */
    async refreshLocalAvailability(): Promise<boolean> {
        this.localAvailable = await this.localProvider.isAvailable();
        return this.localAvailable;
    }

    /**
     * Get local provider for direct access
     */
    getLocalProvider(): OllamaProvider {
        return this.localProvider;
    }
}

/**
 * Smart cost/latency optimizer
 */
export class SmartOptimizer {
    private costPerCloudToken: number = 0.00001; // Rough estimate
    private costPerLocalToken: number = 0;       // Free (electricity only)
    private cloudLatencyMs: number = 500;        // Average
    private localLatencyMs: number = 2000;       // Average for 7B model

    constructor(options?: {
        costPerCloudToken?: number;
        cloudLatencyMs?: number;
        localLatencyMs?: number;
    }) {
        if (options?.costPerCloudToken) this.costPerCloudToken = options.costPerCloudToken;
        if (options?.cloudLatencyMs) this.cloudLatencyMs = options.cloudLatencyMs;
        if (options?.localLatencyMs) this.localLatencyMs = options.localLatencyMs;
    }

    /**
     * Calculate optimal target based on cost and latency
     */
    optimize(
        estimatedTokens: number,
        prioritizeCost: boolean = true,
        maxLatencyMs?: number
    ): ExecutionTarget {
        const cloudCost = estimatedTokens * this.costPerCloudToken;
        const localCost = 0;

        const cloudLatency = this.cloudLatencyMs * (1 + estimatedTokens / 1000);
        const localLatency = this.localLatencyMs * (1 + estimatedTokens / 500);

        // If max latency specified and local exceeds it, use cloud
        if (maxLatencyMs && localLatency > maxLatencyMs && cloudLatency <= maxLatencyMs) {
            return 'cloud';
        }

        if (prioritizeCost) {
            // Local is always cheaper
            return 'local';
        }

        // Prioritize speed
        return cloudLatency < localLatency ? 'cloud' : 'local';
    }

    /**
     * Update latency estimates from actual measurements
     */
    updateLatencies(cloudMs: number, localMs: number): void {
        // Exponential moving average
        this.cloudLatencyMs = this.cloudLatencyMs * 0.8 + cloudMs * 0.2;
        this.localLatencyMs = this.localLatencyMs * 0.8 + localMs * 0.2;
    }
}
