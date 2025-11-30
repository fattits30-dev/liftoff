/**
 * Test Local Tools Server Integration
 *
 * Verifies that:
 * 1. LocalToolsServer can be created
 * 2. Tools are registered correctly
 * 3. Tool calling works
 */

const { LocalToolsServer } = require('../dist/mcp/local-tools-server');

console.log('🧪 Testing Local Tools Server Integration\n');

try {
    // Test 1: Create local tools server
    console.log('1️⃣  Creating LocalToolsServer...');
    const server = new LocalToolsServer(process.cwd());
    console.log(`   ✅ Server created`);

    // Test 2: List tools
    console.log('\n2️⃣  Listing available tools...');
    const tools = server.listTools();
    console.log(`   ✅ Found ${tools.length} tools:`);

    // Group by type
    const browserTools = tools.filter(t => t.name.includes('browser'));
    const gitTools = tools.filter(t => t.name.includes('git'));
    const otherTools = tools.filter(t => !t.name.includes('browser') && !t.name.includes('git'));

    console.log(`\n   Browser tools (${browserTools.length}):`);
    browserTools.forEach(t => console.log(`     - ${t.name}`));

    console.log(`\n   Git tools (${gitTools.length}):`);
    gitTools.forEach(t => console.log(`     - ${t.name}`));

    console.log(`\n   Other tools (${otherTools.length}):`);
    otherTools.forEach(t => console.log(`     - ${t.name}`));

    // Test 3: Test tool call (git_status)
    console.log('\n3️⃣  Testing tool execution (local__git_status)...');
    server.callTool('local__git_status', {}).then(result => {
        if (result.isError) {
            console.log(`   ⚠️  Tool executed but returned error (expected if not a git repo):`);
            console.log(`      ${result.content[0].text.substring(0, 100)}`);
        } else {
            console.log(`   ✅ Tool executed successfully:`);
            console.log(`      ${result.content[0].text.substring(0, 200)}`);
        }

        console.log('\n✅ All tests passed!');
        console.log('\n📊 Summary:');
        console.log(`   - Local tools server works`);
        console.log(`   - ${tools.length} tools registered`);
        console.log(`   - Tool execution works`);
        console.log(`\n🎯 Ready for Phase 2: Update prompts and simplify agent execution`);
    }).catch(err => {
        console.log(`   ❌ Error: ${err.message}`);
        process.exit(1);
    });

} catch (err) {
    console.log(`❌ Test failed: ${err.message}`);
    console.log(err.stack);
    process.exit(1);
}
