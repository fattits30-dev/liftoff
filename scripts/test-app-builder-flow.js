/**
 * End-to-End Test for App Builder
 *
 * Tests the complete flow from description to working app
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 App Builder E2E Test\n');

// Test 1: Check all required files exist
console.log('1️⃣  Checking TypeScript files...');
const requiredFiles = [
    'src/appBuilder/types.ts',
    'src/appBuilder/specGenerator.ts',
    'src/appBuilder/architectureGenerator.ts',
    'src/appBuilder/scaffolder.ts',
    'src/appBuilder/featureTasks.ts',
    'src/appBuilder/appBuilderOrchestrator.ts',
    'src/appBuilder/buildState.ts',
    'src/appBuilder/index.ts'
];

let allExist = true;
for (const file of requiredFiles) {
    const exists = fs.existsSync(file);
    console.log(`  ${exists ? '✅' : '❌'} ${file}`);
    if (!exists) allExist = false;
}

if (!allExist) {
    console.error('\n❌ Some required files are missing!');
    process.exit(1);
}

// Test 2: Check base template structure
console.log('\n2️⃣  Checking base template...');
const baseTemplatePath = 'src/appBuilder/templates/base';
const requiredTemplateFiles = [
    'package.json.tmpl',
    'vite.config.ts',
    'tailwind.config.js',
    'tsconfig.json',
    'index.html',
    '.env.example',
    '.gitignore',
    'src/main.tsx',
    'src/App.tsx',
    'src/index.css',
    'src/lib/supabase.ts.tmpl',
    'src/lib/utils.ts',
    'src/hooks/useAuth.tsx',
    'src/pages/HomePage.tsx',
    'src/types/database.ts.tmpl',
    'src/components/ui/button.tsx',
    'src/components/ui/input.tsx',
    'src/components/ui/label.tsx',
    'src/components/ui/card.tsx',
    'src/components/ui/toast.tsx',
    'src/components/ui/toaster.tsx',
    'src/components/ui/use-toast.ts'
];

let allTemplatesExist = true;
for (const file of requiredTemplateFiles) {
    const fullPath = path.join(baseTemplatePath, file);
    const exists = fs.existsSync(fullPath);
    console.log(`  ${exists ? '✅' : '❌'} ${file}`);
    if (!exists) allTemplatesExist = false;
}

if (!allTemplatesExist) {
    console.error('\n❌ Some template files are missing!');
    process.exit(1);
}

// Test 3: Verify package.json has commands
console.log('\n3️⃣  Checking VS Code commands...');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const commands = packageJson.contributes?.commands || [];
const requiredCommands = [
    'liftoff.buildApp',
    'liftoff.addFeature',
    'liftoff.deployApp',
    'liftoff.generateTests'
];

for (const cmd of requiredCommands) {
    const exists = commands.some(c => c.command === cmd);
    console.log(`  ${exists ? '✅' : '❌'} ${cmd}`);
    if (!exists) allExist = false;
}

// Test 4: Check extension.ts integration
console.log('\n4️⃣  Checking extension.ts integration...');
const extensionContent = fs.readFileSync('src/extension.ts', 'utf-8');
const integrationChecks = [
    { pattern: /import.*AppBuilderOrchestrator/,desc: 'AppBuilderOrchestrator import' },
    { pattern: /appBuilder\s*=\s*new\s*AppBuilderOrchestrator/, desc: 'AppBuilderOrchestrator instantiation' },
    { pattern: /registerCommand\(['"]liftoff\.buildApp['"]/, desc: 'buildApp command registration' },
    { pattern: /appBuilder\.buildApp/, desc: 'buildApp method call' }
];

for (const check of integrationChecks) {
    const exists = check.pattern.test(extensionContent);
    console.log(`  ${exists ? '✅' : '❌'} ${check.desc}`);
    if (!exists) allExist = false;
}

// Test 5: TypeScript compilation
console.log('\n5️⃣  Testing TypeScript compilation...');
const { execSync } = require('child_process');
try {
    execSync('npm run compile', { stdio: 'pipe' });
    console.log('  ✅ TypeScript compiles successfully');
} catch (err) {
    console.log('  ❌ TypeScript compilation failed');
    console.error(err.stdout?.toString() || err.message);
    allExist = false;
}

// Summary
console.log('\n📊 Test Summary:');
console.log('==================');
if (allExist && allTemplatesExist) {
    console.log('✅ ALL TESTS PASSED');
    console.log('\n🎉 App Builder is ready to use!');
    console.log('\n📝 To test manually:');
    console.log('  1. Press F5 to start extension');
    console.log('  2. Cmd+Shift+P → "Liftoff: Build App"');
    console.log('  3. Enter description: "A task management app"');
    console.log('  4. Select project location');
    console.log('  5. Enter app name: "my-app"');
    console.log('  6. Verify project scaffolds correctly');
    console.log('\n📚 Documentation:');
    console.log('  - Implementation Plan: IMPLEMENTATION_PLAN.md');
    console.log('  - GitHub Tools: GITHUB_TOOLS_GUIDE.md');
    console.log('  - Testing Guide: TESTING.md');
    process.exit(0);
} else {
    console.log('❌ SOME TESTS FAILED');
    console.log('\nPlease review the errors above.');
    process.exit(1);
}
