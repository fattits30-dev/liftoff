/**
 * Ollama Provider - Local model inference for heavy lifting
 *
 * Your RX 6600 XT earning its keep with Devstral/Qwen running locally.
 * Sheffield engineering at its finest, innit.
 */

export interface OllamaMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface OllamaConfig {
    baseUrl: string;
    model: string;
    contextLength: number;
    temperature: number;
}

export interface OllamaGenerateOptions {
    temperature?: number;
    numCtx?: number;
    numPredict?: number;
    topP?: number;
    topK?: number;
    stop?: string[];
}

export interface OllamaModelInfo {
    name: string;
    size: number;
    digest: string;
    modifiedAt: string;
    details?: {
        format: string;
        family: string;
        parameter_size: string;
        quantization_level: string;
    };
}

// Recommended local models for coding tasks
export const LOCAL_CODING_MODELS = {
    'devstral': 'devstral:latest',                    // Mistral's coding model
    'devstral-small': 'devstral:small',              // Smaller variant
    'qwen-coder-32b': 'qwen2.5-coder:32b-instruct',  // Best quality (needs VRAM)
    'qwen-coder-14b': 'qwen2.5-coder:14b-instruct',  // Good balance
    'qwen-coder-7b': 'qwen2.5-coder:7b-instruct',    // Fast, lower VRAM
    'qwen-coder-7b-q5': 'qwen2.5-coder:7b-instruct-q5_K_M', // Quantized for 8GB VRAM
    'deepseek-coder': 'deepseek-coder-v2:latest',    // Alternative
    'codellama-34b': 'codellama:34b-instruct',       // Meta's coding model
    'codellama-13b': 'codellama:13b-instruct',       // Smaller CodeLlama
} as const;

export type LocalModelKey = keyof typeof LOCAL_CODING_MODELS;

export class OllamaProvider {
    private baseUrl: string;
    private defaultModel: string;
    private defaultContextLength: number;

    constructor(config?: Partial<OllamaConfig>) {
        this.baseUrl = config?.baseUrl || 'http://localhost:11434';
        this.defaultModel = config?.model || 'devstral:latest';
        this.defaultContextLength = config?.contextLength || 8192;
    }

    /**
     * Check if Ollama is running and responsive
     */
    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * List available models
     */
    async listModels(): Promise<OllamaModelInfo[]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            if (!response.ok) {
                throw new Error(`Failed to list models: ${response.status}`);
            }
            const data = await response.json();
            return data.models || [];
        } catch (err: any) {
            throw new Error(`Ollama connection failed: ${err.message}`);
        }
    }

    /**
     * Check if a specific model is available
     */
    async hasModel(modelName: string): Promise<boolean> {
        const models = await this.listModels();
        return models.some(m => m.name === modelName || m.name.startsWith(modelName.split(':')[0]));
    }

    /**
     * Pull a model (download if not present)
     */
    async pullModel(modelName: string, onProgress?: (status: string) => void): Promise<void> {
        const response = await fetch(`${this.baseUrl}/api/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: modelName, stream: true })
        });

        if (!response.ok || !response.body) {
            throw new Error(`Failed to pull model: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const lines = decoder.decode(value).split('\n').filter(l => l.trim());
            for (const line of lines) {
                try {
                    const data = JSON.parse(line);
                    if (onProgress && data.status) {
                        onProgress(data.status);
                    }
                } catch {}
            }
        }
    }

    /**
     * Generate completion (non-streaming)
     */
    async generate(
        prompt: string,
        options?: OllamaGenerateOptions & { model?: string; system?: string }
    ): Promise<string> {
        const model = options?.model || this.defaultModel;

        const response = await fetch(`${this.baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt,
                system: options?.system,
                stream: false,
                options: {
                    temperature: options?.temperature ?? 0.3, // Lower for code
                    num_ctx: options?.numCtx ?? this.defaultContextLength,
                    num_predict: options?.numPredict ?? 4096,
                    top_p: options?.topP ?? 0.9,
                    top_k: options?.topK ?? 40,
                    stop: options?.stop
                }
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Ollama generate failed: ${response.status} - ${error}`);
        }

        const data = await response.json();
        return data.response;
    }

    /**
     * Generate completion (streaming)
     */
    async *streamGenerate(
        prompt: string,
        options?: OllamaGenerateOptions & { model?: string; system?: string }
    ): AsyncGenerator<string, void, unknown> {
        const model = options?.model || this.defaultModel;

        const response = await fetch(`${this.baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt,
                system: options?.system,
                stream: true,
                options: {
                    temperature: options?.temperature ?? 0.3,
                    num_ctx: options?.numCtx ?? this.defaultContextLength,
                    num_predict: options?.numPredict ?? 4096,
                    top_p: options?.topP ?? 0.9,
                    top_k: options?.topK ?? 40,
                    stop: options?.stop
                }
            })
        });

        if (!response.ok || !response.body) {
            const error = await response.text();
            throw new Error(`Ollama stream failed: ${response.status} - ${error}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const lines = decoder.decode(value).split('\n').filter(l => l.trim());
                for (const line of lines) {
                    try {
                        const data = JSON.parse(line);
                        if (data.response) {
                            yield data.response;
                        }
                    } catch {}
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Chat completion (non-streaming)
     */
    async chat(
        messages: OllamaMessage[],
        options?: OllamaGenerateOptions & { model?: string }
    ): Promise<string> {
        const model = options?.model || this.defaultModel;

        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages,
                stream: false,
                options: {
                    temperature: options?.temperature ?? 0.3,
                    num_ctx: options?.numCtx ?? this.defaultContextLength,
                    num_predict: options?.numPredict ?? 4096,
                    top_p: options?.topP ?? 0.9,
                    top_k: options?.topK ?? 40,
                    stop: options?.stop
                }
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Ollama chat failed: ${response.status} - ${error}`);
        }

        const data = await response.json();
        return data.message?.content || '';
    }

    /**
     * Chat completion (streaming)
     */
    async *streamChat(
        messages: OllamaMessage[],
        options?: OllamaGenerateOptions & { model?: string }
    ): AsyncGenerator<string, void, unknown> {
        const model = options?.model || this.defaultModel;

        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages,
                stream: true,
                options: {
                    temperature: options?.temperature ?? 0.3,
                    num_ctx: options?.numCtx ?? this.defaultContextLength,
                    num_predict: options?.numPredict ?? 4096,
                    top_p: options?.topP ?? 0.9,
                    top_k: options?.topK ?? 40,
                    stop: options?.stop
                }
            })
        });

        if (!response.ok || !response.body) {
            const error = await response.text();
            throw new Error(`Ollama stream chat failed: ${response.status} - ${error}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const lines = decoder.decode(value).split('\n').filter(l => l.trim());
                for (const line of lines) {
                    try {
                        const data = JSON.parse(line);
                        if (data.message?.content) {
                            yield data.message.content;
                        }
                    } catch {}
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Get model info
     */
    async getModelInfo(modelName?: string): Promise<any> {
        const model = modelName || this.defaultModel;

        const response = await fetch(`${this.baseUrl}/api/show`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: model })
        });

        if (!response.ok) {
            throw new Error(`Failed to get model info: ${response.status}`);
        }

        return response.json();
    }

    /**
     * Set default model
     */
    setModel(model: string): void {
        this.defaultModel = model;
    }

    /**
     * Get current model
     */
    getModel(): string {
        return this.defaultModel;
    }

    /**
     * Set context length
     */
    setContextLength(length: number): void {
        this.defaultContextLength = length;
    }
}
