/**
 * Ollama Provider - Local LLM inference via Ollama
 *
 * @remarks
 * Provides a compatible interface with HuggingFaceProvider for drop-in replacement.
 * Connects to a local or remote Ollama instance for running open-source LLMs.
 *
 * Supports both local models (fast, private) and cloud models (more capable).
 *
 * @example
 * ```typescript
 * const provider = new OllamaProvider('http://localhost:11434', 'deepseek-coder:6.7b');
 * const isRunning = await provider.healthCheck();
 * if (isRunning) {
 *   const response = await provider.chat(
 *     'deepseek-coder:6.7b',
 *     [{ role: 'user', content: 'Hello!' }]
 *   );
 * }
 * ```
 */

export interface OllamaMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface OllamaConfig {
    baseUrl: string;
    model: string;
    maxTokens: number;
    temperature: number;
}

export class OllamaProvider {
    private baseUrl: string;
    private defaultModel: string;

    /**
     * Create a new Ollama provider instance
     *
     * @param baseUrl - Ollama server URL (default: 'http://localhost:11434')
     * @param defaultModel - Default model to use (default: 'deepseek-v3.1:671b-cloud')
     *
     * @remarks
     * The baseUrl should point to a running Ollama instance. Use `healthCheck()`
     * to verify connectivity before making requests.
     */
    constructor(baseUrl: string = 'http://localhost:11434', defaultModel: string = 'deepseek-v3.1:671b-cloud') {
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.defaultModel = defaultModel;
        console.log(`[OllamaProvider] Initialized with baseUrl: ${this.baseUrl}, model: ${this.defaultModel}`);
    }

    /**
     * Stream chat completions from Ollama
     *
     * @param model - Model name (e.g., 'deepseek-coder:6.7b', 'deepseek-v3.1:671b-cloud')
     * @param messages - Array of chat messages with role and content
     * @param options - Optional parameters for max tokens, temperature, and thinking mode
     * @returns AsyncGenerator yielding response chunks as they arrive
     *
     * @throws {Error} If Ollama API returns an error or is unreachable
     *
     * @remarks
     * Compatible interface with HuggingFaceProvider for drop-in replacement.
     * Uses Ollama's native streaming format where each line is a JSON object
     * with `message.content` and `done` fields.
     *
     * @example
     * ```typescript
     * for await (const chunk of provider.streamChat(
     *   'deepseek-coder:6.7b',
     *   [{ role: 'user', content: 'Write a function' }],
     *   { temperature: 0.7 }
     * )) {
     *   process.stdout.write(chunk);
     * }
     * ```
     */
    async *streamChat(
        model: string,
        messages: OllamaMessage[],
        options: { maxTokens?: number; temperature?: number; thinking?: boolean } = {}
    ): AsyncGenerator<string, void, unknown> {
        const { maxTokens = 4096, temperature = 0.7, thinking = true } = options;
        const modelToUse = model || this.defaultModel;

        console.log(`[OllamaProvider] Streaming chat with model: ${modelToUse} (thinking: ${thinking})`);

        try {
            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: modelToUse,
                    messages: messages,
                    stream: true,
                    options: {
                        num_predict: maxTokens,
                        temperature: temperature,
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
            }

            if (!response.body) {
                throw new Error('No response body from Ollama');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const parsed = JSON.parse(line);
                        
                        // Ollama format: { message: { content: "..." }, done: false }
                        if (parsed.message?.content) {
                            yield parsed.message.content;
                        }

                        // Check if stream is done
                        if (parsed.done) {
                            console.log(`[OllamaProvider] Stream completed`);
                            return;
                        }
                    } catch (_e) {
                        console.warn('[OllamaProvider] Failed to parse line:', line);
                    }
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[OllamaProvider] Stream error:', errorMessage);
            throw new Error(`Ollama streaming failed: ${errorMessage}`);
        }
    }

    /**
     * Non-streaming chat (waits for full response)
     */
    async chat(
        model: string,
        messages: OllamaMessage[],
        options: { maxTokens?: number; temperature?: number } = {}
    ): Promise<string> {
        const { maxTokens = 4096, temperature = 0.7 } = options;
        const modelToUse = model || this.defaultModel;

        console.log(`[OllamaProvider] Chat (non-streaming) with model: ${modelToUse}`);

        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: modelToUse,
                messages: messages,
                stream: false,
                options: {
                    num_predict: maxTokens,
                    temperature: temperature,
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return data.message?.content || '';
    }

    /**
     * List available models in the local Ollama instance
     *
     * @returns Array of model names (e.g., ['deepseek-coder:6.7b', 'qwen2.5-coder'])
     *
     * @remarks
     * Returns an empty array if the request fails or no models are installed.
     * Use `pullModel()` to download new models from the Ollama registry.
     *
     * @example
     * ```typescript
     * const models = await provider.listModels();
     * console.log('Available models:', models.join(', '));
     * ```
     */
    async listModels(): Promise<string[]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            if (!response.ok) {
                throw new Error(`Failed to list models: ${response.status}`);
            }
            const data = await response.json();
            return data.models?.map((m: any) => m.name) || [];
        } catch (error) {
            console.error('[OllamaProvider] Failed to list models:', error);
            return [];
        }
    }

    /**
     * Check if Ollama is running and accessible
     *
     * @returns True if Ollama server responds to /api/tags endpoint, false otherwise
     *
     * @remarks
     * Use this before making other API calls to verify the server is reachable.
     * Returns false if the server is down, unreachable, or returns an error status.
     *
     * @example
     * ```typescript
     * if (!(await provider.healthCheck())) {
     *   console.error('Ollama is not running. Start it with: ollama serve');
     * }
     * ```
     */
    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`, {
                method: 'GET',
            });
            return response.ok;
        } catch (error) {
            console.error('[OllamaProvider] Health check failed:', error);
            return false;
        }
    }

    /**
     * Pull a model from Ollama registry
     */
    async pullModel(modelName: string): Promise<void> {
        console.log(`[OllamaProvider] Pulling model: ${modelName}`);
        const response = await fetch(`${this.baseUrl}/api/pull`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: modelName,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to pull model ${modelName}: ${response.status}`);
        }
    }
}

// Common Ollama models for coding
export const OLLAMA_CODING_MODELS = {
    'deepseek-coder': 'DeepSeek Coder (6.7B - Fast)',
    'deepseek-v3.1:671b-cloud': 'DeepSeek V3.1 (67B Cloud - Best)',
    'qwen2.5-coder': 'Qwen 2.5 Coder (32B)',
    'codellama': 'Code Llama (7B/13B/34B)',
    'phind-codellama': 'Phind Code Llama (34B)',
    'wizardcoder': 'WizardCoder (15B)',
    'starcoder2': 'StarCoder2 (15B)',
} as const;

export const DEFAULT_OLLAMA_MODEL = 'deepseek-v3.1:671b-cloud';
