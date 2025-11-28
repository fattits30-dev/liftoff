import * as vscode from 'vscode';

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

// Available coding models via HF Inference Providers
export const CODING_MODELS = {
    'qwen3-coder': 'Qwen/Qwen3-Coder-30B-A3B-Instruct',  // Latest, recommended
    'qwen-32b': 'Qwen/Qwen2.5-Coder-32B-Instruct',
    'qwen-14b': 'Qwen/Qwen2.5-Coder-14B-Instruct',
    'qwen-7b': 'Qwen/Qwen2.5-Coder-7B-Instruct',
    'deepseek-v3': 'deepseek-ai/DeepSeek-V3-0324',
    'deepseek-r1': 'deepseek-ai/DeepSeek-R1',
    'llama-70b': 'meta-llama/Llama-3.3-70B-Instruct'
} as const;

export const DEFAULT_MODEL = 'Qwen/Qwen3-Coder-30B-A3B-Instruct';

export type ModelKey = keyof typeof CODING_MODELS;

export class HuggingFaceProvider {
    private apiKey: string;
    // New router endpoint (OpenAI-compatible)
    private baseUrl = 'https://router.huggingface.co/v1';
    
    constructor(apiKey: string) {
        this.apiKey = apiKey;
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
                        } catch (e) {
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
        } catch (e) {
            return false;
        }
    }
}
