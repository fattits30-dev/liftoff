/**
 * Model Configuration Constants
 * 
 * Centralized model configuration to avoid hardcoding throughout the codebase.
 * Models can be deprecated/renamed by providers - keeping them here makes updates easy.
 */

// ============================================================================
// Cloud Models (HuggingFace Inference API)
// ============================================================================

export const CLOUD_MODELS = {
    // Primary recommendation - DeepSeek V3 is currently best for coding
    'deepseek-v3': 'deepseek-ai/DeepSeek-V3-0324',
    'deepseek-r1': 'deepseek-ai/DeepSeek-R1',
    
    // Qwen family - good alternatives
    'qwen3-coder': 'Qwen/Qwen3-Coder-30B-A3B-Instruct',
    'qwen-32b': 'Qwen/Qwen2.5-Coder-32B-Instruct',
    'qwen-14b': 'Qwen/Qwen2.5-Coder-14B-Instruct',
    'qwen-7b': 'Qwen/Qwen2.5-Coder-7B-Instruct',
    
    // Llama - Meta's open models
    'llama-70b': 'meta-llama/Llama-3.3-70B-Instruct',
} as const;

export type CloudModelKey = keyof typeof CLOUD_MODELS;

// Default cloud model - used when none specified
export const DEFAULT_CLOUD_MODEL: CloudModelKey = 'deepseek-v3';
export const DEFAULT_CLOUD_MODEL_NAME = CLOUD_MODELS[DEFAULT_CLOUD_MODEL];

// Fallback models to try if primary fails (in order)
export const CLOUD_MODEL_FALLBACKS = [
    'deepseek-ai/DeepSeek-V3-0324',
    'Qwen/Qwen2.5-Coder-32B-Instruct',
    'Qwen/Qwen2.5-Coder-7B-Instruct',
    'deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct',
] as const;

// ============================================================================
// Local Models (Ollama)
// ============================================================================

export const OLLAMA_MODELS = {
    // DeepSeek family - best for coding
    'deepseek-v3.1': 'deepseek-v3.1:671b-cloud',
    'deepseek-r1': 'deepseek-r1:8b',
    'deepseek-coder': 'deepseek-coder:33b',
    'deepseek-coder-6.7b': 'deepseek-coder:6.7b',

    // Qwen family - good alternatives
    'qwen2.5-coder-32b': 'qwen2.5-coder:32b',
    'qwen2.5-coder-14b': 'qwen2.5-coder:14b',
    'qwen2.5-coder-7b': 'qwen2.5-coder:7b',
    'qwen2.5-coder-7b-instruct': 'qwen2.5-coder:7b-instruct-q5_K_M',

    // Code Llama
    'codellama-34b': 'codellama:34b',
    'codellama-13b': 'codellama:13b',
    'codellama-7b': 'codellama:7b',

    // Specialized models
    'phind-codellama': 'phind-codellama:34b',
    'wizardcoder': 'wizardcoder:15b',
    'starcoder2': 'starcoder2:15b',
} as const;

export type OllamaModelKey = keyof typeof OLLAMA_MODELS;

// Default Ollama models
export const DEFAULT_OLLAMA_MODEL: OllamaModelKey = 'deepseek-v3.1'; // For orchestrator (671B cloud)
export const DEFAULT_OLLAMA_MODEL_NAME = OLLAMA_MODELS[DEFAULT_OLLAMA_MODEL];

export const DEFAULT_OLLAMA_AGENT_MODEL: OllamaModelKey = 'deepseek-v3.1'; // For agents (671B cloud - best quality)
export const DEFAULT_OLLAMA_AGENT_MODEL_NAME = OLLAMA_MODELS[DEFAULT_OLLAMA_AGENT_MODEL];

// ============================================================================
// Provider Configuration
// ============================================================================

export type LLMProvider = 'huggingface' | 'ollama';

export const DEFAULT_PROVIDER: LLMProvider = 'ollama'; // Changed from huggingface

// ============================================================================
// API Endpoints
// ============================================================================

export const API_ENDPOINTS = {
    huggingface: 'https://router.huggingface.co/v1',
    ollama: 'http://localhost:11434',
} as const;

// ============================================================================
// Model Parameters
// ============================================================================

export const DEFAULT_MODEL_PARAMS = {
    maxTokens: 4096,
    temperature: 0.2,  // Lower for code generation
    topP: 0.95,
} as const;

export const ORCHESTRATOR_MODEL_PARAMS = {
    maxTokens: 2048,  // Shorter for orchestration decisions
    temperature: 0.2,
} as const;

export const AGENT_MODEL_PARAMS = {
    maxTokens: 32768,  // High limit for free local models (Ollama)
    temperature: 0.2,  // Low for code generation
    thinking: true,    // Enable extended thinking
} as const;

// ============================================================================
// Timeouts and Limits
// ============================================================================

export const LIMITS = {
    maxIterations: 500,  // High limit - loop detection will catch stuck agents
    orchestratorMaxIterations: 100,  // Increased for complex multi-agent tasks
    defaultTimeout: 300000,  // 5 minutes
    testTimeout: 180000,     // 3 minutes
    shellTimeout: 120000,    // 2 minutes
    browserLaunchTimeout: 30000,  // 30 seconds
    browserIdleTimeout: 5 * 60 * 1000,  // 5 minutes
} as const;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get full model name from key, with fallback to key if not found
 */
export function getCloudModelName(keyOrName: string): string {
    return CLOUD_MODELS[keyOrName as CloudModelKey] || keyOrName;
}

/**
 * Get Ollama model name from key, with fallback to key if not found
 */
export function getOllamaModelName(keyOrName: string): string {
    return OLLAMA_MODELS[keyOrName as OllamaModelKey] || keyOrName;
}
