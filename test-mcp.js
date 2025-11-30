// Direct test of MCP integration
const path = require('path');

async function testMcpIntegration() {
    console.log('=== Testing MCP Integration ===\n');

    try {
        // Import after compile
        const { getMcpRouter } = require('./dist/mcp');
        const mcpRouter = getMcpRouter();

        console.log('1. Loading MCP configuration...');
        const workspaceRoot = process.cwd();
        const configs = await mcpRouter.loadConfig(workspaceRoot);
        console.log(`   ✓ Found ${configs.length} MCP servers\n`);

        console.log('2. Connecting to servers...');
        await mcpRouter.connectAll(configs);
        console.log('   ✓ Connected to all servers\n');

        console.log('3. Getting available tools...');
        const toolsCompact = mcpRouter.getToolsCompact();
        console.log('   Tools description:\n');
        console.log(toolsCompact);
        console.log('\n');

        console.log('4. Testing context7 resolve-library-id...');
        const result = await mcpRouter.callTool('resolve-library-id', { library: 'react' });
        console.log(`   Success: ${result.success}`);
        console.log(`   Output: ${result.output}`);
        console.log(`   Error: ${result.error || 'none'}`);
        console.log('\n');

        console.log('5. Testing context7 get-library-docs...');
        if (result.success && result.output) {
            // Try to get docs using the library ID from previous result
            const docsResult = await mcpRouter.callTool('get-library-docs', {
                libraryId: result.output.trim(),
                query: 'hooks'
            });
            console.log(`   Success: ${docsResult.success}`);
            console.log(`   Output length: ${docsResult.output?.length || 0} chars`);
            console.log(`   Error: ${docsResult.error || 'none'}`);
        } else {
            console.log('   ✗ Skipped - resolve-library-id failed');
        }

        console.log('\n=== TEST COMPLETE ===');
        process.exit(0);

    } catch (err) {
        console.error('\n✗ FATAL ERROR:', err.message);
        console.error('Stack:', err.stack);
        process.exit(1);
    }
}

testMcpIntegration();
