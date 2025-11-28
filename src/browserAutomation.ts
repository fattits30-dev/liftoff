import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as vscode from 'vscode';

export class BrowserAutomation {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    
    async launch(): Promise<void> {
        if (!this.browser) {
            this.browser = await chromium.launch({ 
                headless: false,
                args: ['--start-maximized']
            });
            this.context = await this.browser.newContext({
                viewport: null
            });
            this.page = await this.context.newPage();
        }
    }
    
    async navigate(url: string): Promise<void> {
        await this.ensurePage();
        await this.page!.goto(url, { waitUntil: 'networkidle' });
    }
    
    async screenshot(path: string): Promise<string> {
        await this.ensurePage();
        await this.page!.screenshot({ path, fullPage: true });
        return path;
    }
    
    async click(selector: string): Promise<void> {
        await this.ensurePage();
        await this.page!.click(selector);
    }
    
    async type(selector: string, text: string): Promise<void> {
        await this.ensurePage();
        await this.page!.fill(selector, text);
    }
    
    async evaluate(script: string): Promise<any> {
        await this.ensurePage();
        return await this.page!.evaluate(script);
    }
    
    async waitForSelector(selector: string, timeout = 5000): Promise<void> {
        await this.ensurePage();
        await this.page!.waitForSelector(selector, { timeout });
    }

    async getPageContent(): Promise<string> {
        await this.ensurePage();
        return await this.page!.content();
    }
    
    async getConsoleErrors(): Promise<string[]> {
        const errors: string[] = [];
        this.page?.on('console', msg => {
            if (msg.type() === 'error') {
                errors.push(msg.text());
            }
        });
        return errors;
    }
    
    async testResponsive(url: string, viewports: { width: number; height: number; name: string }[]): Promise<Map<string, string>> {
        const screenshots = new Map<string, string>();
        await this.launch();
        
        for (const vp of viewports) {
            await this.page!.setViewportSize({ width: vp.width, height: vp.height });
            await this.page!.goto(url, { waitUntil: 'networkidle' });
            const path = `screenshot-${vp.name}-${Date.now()}.png`;
            await this.page!.screenshot({ path });
            screenshots.set(vp.name, path);
        }
        
        return screenshots;
    }
    
    private async ensurePage(): Promise<void> {
        if (!this.page) {
            await this.launch();
        }
    }
    
    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.page = null;
        }
    }
}

// Export singleton instance
export const browserAutomation = new BrowserAutomation();
