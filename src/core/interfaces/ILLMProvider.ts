/**
 * LLM Provider Interface
 * Abstracts AI model interactions for different providers
 */

export interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    toolCallId?: string;
}

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}

export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface CompletionOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    stopSequences?: string[];
    tools?: ToolDefinition[];
    toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
    stream?: boolean;
}

export interface CompletionResult {
    content: string;
    toolCalls?: ToolCall[];
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
    model: string;
}

export interface StreamChunk {
    content?: string;
    toolCall?: Partial<ToolCall>;
    done: boolean;
}

export interface ILLMProvider {
    /**
     * Provider name (e.g., 'huggingface', 'openai', 'ollama')
     */
    readonly name: string;

    /**
     * Check if provider is available
     */
    isAvailable(): Promise<boolean>;

    /**
     * Generate a completion
     */
    complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult>;

    /**
     * Stream a completion
     */
    stream(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk>;

    /**
     * Generate embeddings for text
     */
    embed(text: string | string[]): Promise<number[][]>;

    /**
     * List available models
     */
    listModels(): Promise<string[]>;

    /**
     * Get current model
     */
    getCurrentModel(): string;

    /**
     * Set current model
     */
    setModel(model: string): void;
}
