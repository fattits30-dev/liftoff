import * as vscode from 'vscode';

export interface HFMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface HFResponse {
    choices: Array<{
        message: {
            content: string;
        };
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export class HuggingFaceProvider {
    private apiKey: string;
    private baseUrl = 'https://api-inference.huggingface.co/models';
    
    // Available models for different agent types
    private models = {
        large: 'Qwen/Qwen2.5-Coder-32B-Instruct',
        medium: 'Qwen/Qwen2.5-Coder-7B-Instruct',
        small: 'Qwen/Qwen2.5-Coder-1.5B-Instruct',
        deepseek: 'deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct'
    };
    
    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }
    
    async chat(
        messages: HFMessage[], 
        model?: string,
        onChunk?: (text: string) => void
    ): Promise<string> {
        const selectedModel = model || this.models.large;
        const url = `${this.baseUrl}/${selectedModel}/v1/chat/completions`;
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: selectedModel,
                    messages: messages,
                    max_tokens: 4096,
                    temperature: 0.7,
                    stream: true
                })
            });
            
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`HF API error: ${response.status} - ${error}`);
            }
            
            // Handle streaming response
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';
            
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n').filter(line => line.trim());
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') continue;
                            
                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed.choices?.[0]?.delta?.content;
                                if (content) {
                                    fullResponse += content;
                                    if (onChunk) onChunk(content);
                                }
                            } catch (e) {
                                // Skip unparseable chunks
                            }
                        }
                    }
                }
            }
            
            return fullResponse;
            
        } catch (error: any) {
            throw new Error(`HuggingFace API error: ${error.message}`);
        }
    }
    
    async chatNonStreaming(messages: HFMessage[], model?: string): Promise<string> {
        const selectedModel = model || this.models.large;
        const url = `${this.baseUrl}/${selectedModel}/v1/chat/completions`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: messages,
                max_tokens: 4096,
                temperature: 0.7,
                stream: false
            })
        });
        
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`HF API error: ${response.status} - ${error}`);
        }
        
        const data: HFResponse = await response.json();
        return data.choices[0]?.message?.content || '';
    }
    
    getModels() {
        return this.models;
    }
    
    setApiKey(key: string) {
        this.apiKey = key;
    }
}
