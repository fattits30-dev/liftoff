# Testing Guide for Liftoff Extension

## Overview

Liftoff uses a comprehensive testing strategy with three levels of tests:

1. **Unit Tests** - Test individual components in isolation
2. **Integration Tests** - Test component interactions
3. **E2E Tests** - Test complete user workflows

## Quick Start

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run specific test suites
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests only
npm run test:e2e          # E2E tests only

# Watch mode for development
npm run test:watch

# Coverage report
npm run test:coverage
```

## Test Structure

```
tests/
├── unit/                      # Unit tests
│   ├── safety/
│   │   └── guardrails.test.ts
│   ├── collaboration/
│   │   └── loopDetector.test.ts
│   └── appBuilder/
│       └── specGenerator.test.ts
├── integration/               # Integration tests
│   ├── orchestrator.test.ts
│   └── agent-system.test.ts
├── e2e/                       # End-to-end tests
│   └── app-builder.spec.ts
└── fixtures/                  # Test fixtures & mocks
    ├── test-workspace/
    └── e2e-output/
```

## Development Workflow

### Using VS Code Dev Container

The project includes a VS Code dev container with all dependencies pre-installed:

1. Install **Docker** and **VS Code Remote - Containers** extension
2. Open project in VS Code
3. Click "Reopen in Container" when prompted
4. All dependencies are automatically installed

### Manual Setup

```bash
# Install dependencies
npm install

# Install Playwright browsers (for E2E tests)
npx playwright install --with-deps

# Run tests
npm test
```

## Writing Tests

### Unit Test Example

```typescript
import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { MyComponent } from '../../src/myComponent';

describe('MyComponent', () => {
    let component: MyComponent;

    beforeEach(() => {
        component = new MyComponent();
    });

    it('should do something', () => {
        const result = component.doSomething();
        expect(result).to.equal('expected value');
    });
});
```

### Integration Test Example

```typescript
import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { MainOrchestrator } from '../../src/mainOrchestrator';

describe('MainOrchestrator Integration', () => {
    let orchestrator: MainOrchestrator;

    beforeEach(() => {
        orchestrator = new MainOrchestrator(/* ... */);
    });

    afterEach(() => {
        orchestrator.dispose();
    });

    it('should orchestrate agents', async () => {
        const result = await orchestrator.delegateTask('test task', 'general');
        expect(result).to.have.property('success', true);
    });
});
```

### E2E Test Example

```typescript
import { test, expect } from '@playwright/test';

test('should build app end-to-end', async () => {
    const result = await buildApp('My App', targetDir);
    expect(result.success).toBe(true);

    const files = await fs.readdir(targetDir);
    expect(files).toContain('package.json');
});
```

## CI/CD Pipeline

### GitHub Actions

The project uses GitHub Actions for automated testing on every push and PR:

- **Lint & Type Check** - ESLint and TypeScript compilation
- **Unit Tests** - Run on Ubuntu, Windows, and macOS with Node 18 & 20
- **Integration Tests** - Ubuntu latest with Node 20
- **E2E Tests** - Ubuntu with Playwright browsers
- **Security Scan** - npm audit and Trivy vulnerability scanning
- **Build** - Package VS Code extension (.vsix)

### Workflow Files

- `.github/workflows/ci.yml` - Main CI pipeline
- `.github/workflows/release.yml` - Release automation (optional)

## Test Coverage

### Viewing Coverage

```bash
npm run test:coverage
```

Coverage reports are generated in `coverage/` directory:
- `coverage/lcov-report/index.html` - Visual HTML report
- `coverage/lcov.info` - LCOV format for CI tools

### Coverage Goals

- **Overall:** 80% minimum
- **Core Components:** 90% minimum
  - Safety guardrails
  - Agent orchestration
  - App builder
- **UI Components:** 70% minimum

## Mocking and Fixtures

### Mocking HuggingFace API

```typescript
import sinon from 'sinon';

const mockHF = sinon.stub(hfProvider, 'streamChat').returns({
    async *[Symbol.asyncIterator]() {
        yield 'mocked response';
    }
});
```

### Test Fixtures

Test fixtures are located in `tests/fixtures/`:

- `test-workspace/` - Mock VS Code workspace
- `mock-responses/` - Mock API responses
- `sample-apps/` - Sample app structures for testing

## Debugging Tests

### VS Code Debugging

1. Set breakpoints in test files
2. Open Test Explorer (beaker icon in sidebar)
3. Right-click test → "Debug Test"

### Command Line Debugging

```bash
# Run specific test file
npm run test:unit -- tests/unit/safety/guardrails.test.ts

# Run with verbose output
npm run test:unit -- --reporter spec

# Debug with node inspector
node --inspect-brk node_modules/.bin/mocha tests/unit/**/*.test.ts
```

## Common Issues

### Tests Timing Out

Increase timeout in test file:
```typescript
it('slow test', async () => {
    // ...
}).timeout(10000); // 10 seconds
```

### Module Not Found Errors

```bash
# Rebuild TypeScript
npm run compile

# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Playwright Browser Issues

```bash
# Reinstall browsers
npx playwright install --with-deps
```

## Best Practices

1. **Isolate Tests** - Each test should be independent
2. **Use beforeEach/afterEach** - Clean up state between tests
3. **Mock External Dependencies** - Don't hit real APIs in tests
4. **Test Edge Cases** - Not just happy paths
5. **Descriptive Names** - Test names should describe what they test
6. **Keep Tests Fast** - Unit tests should run in milliseconds
7. **Don't Test Implementation Details** - Test behavior, not internals

## Security Testing

### Sensitive Data

Never commit real API keys or secrets in tests. Use:
- Environment variables: `process.env.TEST_API_KEY`
- Mock responses for API calls
- `.env.test` file (gitignored)

### Example

```typescript
const apiKey = process.env.HF_API_KEY || 'mock-key-for-testing';
```

## Performance Testing

### Benchmarking

```typescript
import { performance } from 'perf_hooks';

it('should complete in reasonable time', async () => {
    const start = performance.now();
    await expensiveOperation();
    const duration = performance.now() - start;

    expect(duration).to.be.lessThan(1000); // < 1 second
});
```

## Contributing

When contributing code:

1. Write tests for new features
2. Ensure all tests pass: `npm test`
3. Check test coverage: `npm run test:coverage`
4. Update this guide if adding new test patterns

## Resources

- [Mocha Documentation](https://mochajs.org/)
- [Chai Assertions](https://www.chaijs.com/)
- [Sinon Mocking](https://sinonjs.org/)
- [Playwright Testing](https://playwright.dev/)
- [VS Code Extension Testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension)

## Getting Help

- Open an issue on GitHub
- Check existing test files for examples
- Review CI logs for test failures
