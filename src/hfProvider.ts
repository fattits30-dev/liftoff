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

export class HuggingFaceProvider {
    private apiKey: string;
    // New router endpoint (OpenAI-compatible)
    private baseUrl = API_ENDPOINTS.huggingface;
    
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

    // Test the connection
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
