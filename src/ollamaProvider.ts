/**
 * Ollama Provider - Local LLM inference via Ollama
 * Compatible interface with HuggingFaceProvider for drop-in replacement
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

    constructor(baseUrl: string = 'http://localhost:11434', defaultModel: string = 'deepseek-v3.1:671b-cloud') {
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.defaultModel = defaultModel;
        console.log(`[OllamaProvider] Initialized with baseUrl: ${this.baseUrl}, model: ${this.defaultModel}`);
    }

    /**
     * Stream chat completions from Ollama
     * Compatible with HuggingFaceProvider interface
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
                    } catch (e) {
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
     * List available models in Ollama
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
