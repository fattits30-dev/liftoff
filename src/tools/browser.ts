// Browser automation tools using Playwright
import { Tool } from './index';

let playwright: any = null;
let browser: any = null;
let page: any = null;

async function ensureBrowser(): Promise<any> {
    if (!playwright) {
        playwright = require('playwright');
    }
    if (!browser) {
        browser = await playwright.chromium.launch({ 
            headless: false,
            slowMo: 50
        });
        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 }
        });
        page = await context.newPage();
    }
    return page;
}

export const BROWSER_TOOLS: Record<string, Tool> = {
    browser_navigate: {
        name: 'browser_navigate',
        description: 'Navigate to a URL. Always do this first after starting the app.',
        parameters: {
            url: { type: 'string', description: 'URL to navigate to', required: true }
        },
        async execute(params) {
            try {
                const p = await ensureBrowser();
                
                // Try multiple times - app may still be starting
                let lastError = '';
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        await p.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
                        await p.waitForTimeout(2000); // Give React/Vue time to render
                        const title = await p.title();
                        return { success: true, output: `Navigated to ${params.url}\nPage title: ${title || '(no title)'}` };
                    } catch (e: any) {
                        lastError = e.message;
                        if (attempt < 3) {
                            await p.waitForTimeout(3000); // Wait before retry
                        }
                    }
                }
                return { success: false, output: '', error: `Failed after 3 attempts: ${lastError}` };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    browser_get_elements: {
        name: 'browser_get_elements',
        description: 'Get all interactive elements on the page (buttons, links, inputs). USE THIS to see what you can interact with!',
        parameters: {},
        async execute() {
            try {
                const p = await ensureBrowser();
                
                const elements = await p.evaluate(() => {
                    const results: any[] = [];
                    
                    // Get buttons
                    document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach((el: any) => {
                        const text = el.innerText?.trim() || el.value || el.getAttribute('aria-label') || '';
                        if (text) {
                            results.push({ type: 'button', text: text.substring(0, 50), selector: `button:has-text("${text.substring(0, 30)}")` });
                        }
                    });
                    
                    // Get links
                    document.querySelectorAll('a[href]').forEach((el: any) => {
                        const text = el.innerText?.trim() || el.getAttribute('aria-label') || '';
                        if (text && text.length > 1) {
                            results.push({ type: 'link', text: text.substring(0, 50), selector: `a:has-text("${text.substring(0, 30)}")` });
                        }
                    });
                    
                    // Get inputs
                    document.querySelectorAll('input, textarea, select').forEach((el: any) => {
                        const type = el.type || el.tagName.toLowerCase();
                        const name = el.name || el.id || el.placeholder || '';
                        const label = el.getAttribute('aria-label') || '';
                        let selector = '';
                        
                        if (el.id) selector = `#${el.id}`;
                        else if (el.name) selector = `[name="${el.name}"]`;
                        else if (el.placeholder) selector = `[placeholder="${el.placeholder}"]`;
                        else selector = `${el.tagName.toLowerCase()}[type="${type}"]`;
                        
                        if (selector) {
                            results.push({ 
                                type: 'input', 
                                inputType: type,
                                name: name || label || 'unnamed',
                                selector 
                            });
                        }
                    });
                    
                    return results.slice(0, 50); // Limit to 50 elements
                });
                
                if (elements.length === 0) {
                    return { success: true, output: 'No interactive elements found. Page may still be loading or uses non-standard elements.' };
                }
                
                let output = `Found ${elements.length} interactive elements:\n\n`;
                
                const buttons = elements.filter((e: any) => e.type === 'button');
                const links = elements.filter((e: any) => e.type === 'link');
                const inputs = elements.filter((e: any) => e.type === 'input');
                
                if (buttons.length > 0) {
                    output += `BUTTONS:\n${buttons.map((b: any) => `  - "${b.text}" → selector: ${b.selector}`).join('\n')}\n\n`;
                }
                if (links.length > 0) {
                    output += `LINKS:\n${links.map((l: any) => `  - "${l.text}" → selector: ${l.selector}`).join('\n')}\n\n`;
                }
                if (inputs.length > 0) {
                    output += `INPUTS:\n${inputs.map((i: any) => `  - [${i.inputType}] ${i.name} → selector: ${i.selector}`).join('\n')}\n\n`;
                }
                
                return { success: true, output };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    browser_click: {
        name: 'browser_click',
        description: 'Click a button or link. Use the selector from browser_get_elements.',
        parameters: {
            selector: { type: 'string', description: 'Selector from browser_get_elements', required: true }
        },
        async execute(params) {
            try {
                const p = await ensureBrowser();
                await p.click(params.selector, { timeout: 10000 });
                await p.waitForTimeout(500);
                return { success: true, output: `Clicked: ${params.selector}` };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    browser_type: {
        name: 'browser_type', 
        description: 'Type into an input field. Use selector from browser_get_elements.',
        parameters: {
            selector: { type: 'string', description: 'Input selector', required: true },
            text: { type: 'string', description: 'Text to type', required: true }
        },
        async execute(params) {
            try {
                const p = await ensureBrowser();
                await p.fill(params.selector, params.text);
                return { success: true, output: `Typed "${params.text}" into ${params.selector}` };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    browser_screenshot: {
        name: 'browser_screenshot',
        description: 'Take a screenshot and save to file',
        parameters: {
            filename: { type: 'string', description: 'Filename (default: screenshot.png)' }
        },
        async execute(params, workspaceRoot) {
            try {
                const p = await ensureBrowser();
                const path = require('path');
                const filename = params.filename || `screenshot-${Date.now()}.png`;
                const filepath = path.join(workspaceRoot, filename);
                await p.screenshot({ path: filepath, fullPage: false });
                return { success: true, output: `Screenshot saved: ${filepath}` };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    browser_get_text: {
        name: 'browser_get_text',
        description: 'Get visible text content from the page',
        parameters: {},
        async execute() {
            try {
                const p = await ensureBrowser();
                const text = await p.evaluate(() => {
                    return document.body.innerText.substring(0, 5000);
                });
                return { success: true, output: text || 'No text found' };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    browser_check_element: {
        name: 'browser_check_element',
        description: 'Check if an element exists and is visible',
        parameters: {
            selector: { type: 'string', description: 'Selector to check', required: true }
        },
        async execute(params) {
            try {
                const p = await ensureBrowser();
                const visible = await p.isVisible(params.selector);
                return { success: true, output: visible ? `✓ Element "${params.selector}" is visible` : `✗ Element "${params.selector}" is NOT visible` };
            } catch (_e: any) {
                return { success: true, output: `✗ Element "${params.selector}" not found` };
            }
        }
    },

    browser_wait: {
        name: 'browser_wait',
        description: 'Wait for page to load',
        parameters: {
            seconds: { type: 'number', description: 'Seconds to wait (default: 3)' }
        },
        async execute(params) {
            try {
                const p = await ensureBrowser();
                // Accept both 'seconds' and 'timeout' params
                const secs = params.seconds || params.timeout || 3;
                const ms = (typeof secs === 'number' && secs > 100) ? secs : secs * 1000; // Handle ms vs seconds
                await p.waitForTimeout(Math.min(ms, 30000)); // Max 30 seconds
                return { success: true, output: `Waited ${Math.round(ms/1000)} seconds` };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    },

    browser_close: {
        name: 'browser_close',
        description: 'Close the browser',
        parameters: {},
        async execute() {
            try {
                if (browser) {
                    await browser.close();
                    browser = null;
                    page = null;
                }
                return { success: true, output: 'Browser closed' };
            } catch (e: any) {
                return { success: false, output: '', error: e.message };
            }
        }
    }
};

export function getBrowserToolsDescription(): string {
    return Object.values(BROWSER_TOOLS)
        .map(t => `- ${t.name}: ${t.description}`)
        .join('\n');
}
