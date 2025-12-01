import { CLOUD_MODELS, DEFAULT_CLOUD_MODEL_NAME, API_ENDPOINTS } from './config';

export interface HFMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface HFConfig {
    apiKey: string;
    model: string;
    maxTokens: number;
    temperature: number;
}

// Re-export from config for backward compatibility
export const CODING_MODELS = CLOUD_MODELS;
export const DEFAULT_MODEL = DEFAULT_CLOUD_MODEL_NAME;

export type ModelKey = keyof typeof CODING_MODELS;

/**
 * HuggingFace LLM provider using the OpenAI-compatible Router API
 *
 * @remarks
 * Uses the HuggingFace Router endpoint (https://router.huggingface.co/v1) which
 * provides OpenAI-compatible chat completions with support for streaming.
 *
 * Supported models include DeepSeek, Qwen, Llama, and other coding-optimized models.
 *
 * @example
 * ```typescript
 * const provider = new HuggingFaceProvider('hf_...');
 * for await (const chunk of provider.streamChat(
 *   'deepseek-ai/DeepSeek-V3-0324',
 *   [{ role: 'user', content: 'Hello!' }]
 * )) {
 *   console.log(chunk);
 * }
 * ```
 */
export class HuggingFaceProvider {
    private apiKey: string;
    // New router endpoint (OpenAI-compatible)
    private baseUrl = API_ENDPOINTS.huggingface;

    /**
     * Create a new HuggingFace provider instance
     *
     * @param apiKey - HuggingFace API key (must start with 'hf_')
     * @throws {Error} If API key is missing or invalid format
     */
    constructor(apiKey: string) {
        // API KEY VALIDATION: Prevent crashes from empty/invalid keys
        if (!apiKey || typeof apiKey !== 'string') {
            throw new Error('HuggingFace API key is required');
        }
        const trimmedKey = apiKey.trim();
        if (trimmedKey.length === 0) {
            throw new Error('HuggingFace API key cannot be empty');
        }
        if (!trimmedKey.startsWith('hf_')) {
            console.warn('[HuggingFaceProvider] API key does not start with hf_ - may be invalid');
        }
        this.apiKey = trimmedKey;
    }

    /**
     * Stream chat completions from HuggingFace Router API
     *
     * @param model - Model identifier (e.g., 'deepseek-ai/DeepSeek-V3-0324')
     * @param messages - Array of chat messages with role and content
     * @param options - Optional parameters for max tokens and temperature
     * @returns AsyncGenerator yielding response chunks as they arrive
     *
     * @throws {Error} If the API request fails or returns an error status
     *
     * @remarks
     * Uses Server-Sent Events (SSE) for streaming. The response is parsed
     * in OpenAI-compatible format: `data: {"choices": [{"delta": {"content": "..."}}]}`
     *
     * @example
     * ```typescript
     * for await (const chunk of provider.streamChat(
     *   'deepseek-ai/DeepSeek-V3-0324',
     *   [{ role: 'user', content: 'Write a hello world function' }],
     *   { maxTokens: 1000, temperature: 0.7 }
     * )) {
     *   process.stdout.write(chunk);
     * }
     * ```
     */
    async *streamChat(
        model: string,
        messages: HFMessage[],
        options: { maxTokens?: number; temperature?: number } = {}
    ): AsyncGenerator<string, void, unknown> {
        const { maxTokens = 4096, temperature = 0.7 } = options;
        
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                max_tokens: maxTokens,
                temperature: temperature,
                stream: true
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`HuggingFace API error: ${response.status} - ${error}`);
        }

        if (!response.body) {
            throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const data = line.slice(5).trim();
                        if (data === '[DONE]') continue;
                        if (!data) continue;
                        
                        try {
                            const parsed = JSON.parse(data);
                            // OpenAI-compatible format
                            const content = parsed.choices?.[0]?.delta?.content;
                            if (content) {
                                yield content;
                            }
                        } catch (_e) {
                            // Skip malformed JSON
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Non-streaming chat completion (waits for full response)
     *
     * @param model - Model identifier
     * @param messages - Array of chat messages
     * @param options - Optional parameters for max tokens and temperature
     * @returns Complete response text
     *
     * @remarks
     * This internally uses `streamChat()` and collects all chunks into a single string.
     * For better UX in interactive applications, prefer `streamChat()`.
     */
    async chat(
        model: string,
        messages: HFMessage[],
        options: { maxTokens?: number; temperature?: number } = {}
    ): Promise<string> {
        let result = '';
        for await (const chunk of this.streamChat(model, messages, options)) {
            result += chunk;
        }
        return result;
    }

    /**
     * Test the connection to HuggingFace Router API
     *
     * @param model - Model identifier to test
     * @returns True if connection succeeds, false otherwise
     *
     * @remarks
     * Sends a minimal chat completion request with maxTokens=5 to verify
     * that the API key is valid and the model is accessible.
     */
    async testConnection(model: string): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: 'Hi' }],
                    max_tokens: 5
                })
            });
            
            return response.ok;
        } catch (_e) {
            return false;
        }
    }
}
