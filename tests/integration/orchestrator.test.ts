import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import * as sinon from 'sinon';
import * as path from 'path';
import * as fs from 'fs/promises';
import { MainOrchestrator } from '../../src/mainOrchestrator';
import { AutonomousAgentManager } from '../../src/autonomousAgent';
import { SemanticMemoryStore, OrchestratorMemory } from '../../src/memory/agentMemory';

describe('MainOrchestrator Integration', () => {
    let orchestrator: MainOrchestrator;
    let agentManager: AutonomousAgentManager;
    let semanticMemory: SemanticMemoryStore;
    let orchestratorMemory: OrchestratorMemory;
    let testWorkspace: string;

    beforeEach(async () => {
        testWorkspace = path.join(__dirname, '../fixtures/test-workspace');

        // Create test workspace
        await fs.mkdir(testWorkspace, { recursive: true });

        // Initialize memory systems
        semanticMemory = new SemanticMemoryStore(':memory:');
        await semanticMemory.initialize();

        orchestratorMemory = new OrchestratorMemory(':memory:', semanticMemory);
        await orchestratorMemory.initialize();

        // Create orchestrator
        orchestrator = new MainOrchestrator(testWorkspace, semanticMemory, orchestratorMemory);

        // Mock agent manager (we'll test it separately)
        agentManager = sinon.createStubInstance(AutonomousAgentManager) as any;
    });

    afterEach(async () => {
        // Cleanup
        try {
            await fs.rm(testWorkspace, { recursive: true, force: true });
        } catch (e) {
            // Ignore cleanup errors
        }

        orchestrator?.dispose();
        semanticMemory?.dispose();
        orchestratorMemory?.dispose();
    });

    describe('Task Planning', () => {
        it('should break down complex task into steps', async () => {
            const task = 'Create a login page with authentication';

            // Mock API response
            const mockChat = sinon.stub(orchestrator as any, 'chat').resolves(`
PLAN:
1. Create login form component
2. Add form validation
3. Implement authentication logic
4. Add error handling
5. Style the login page
            `);

            const plan = await orchestrator.planTask(task);

            expect(plan).to.have.property('steps');
            expect(plan.steps).to.be.an('array');
            expect(plan.steps.length).to.be.greaterThan(0);

            mockChat.restore();
        });

        it('should identify required agent types', async () => {
            const task = 'Fix the failing backend tests';

            const plan = await orchestrator.planTask(task);

            expect(plan).to.have.property('requiredAgents');
            expect(plan.requiredAgents).to.include('testing');
            expect(plan.requiredAgents).to.include('backend');
        });
    });

    describe('Agent Delegation', () => {
        it('should delegate frontend tasks to frontend agent', async () => {
            orchestrator.setAgentManager(agentManager);

            const task = 'Update the header component styling';
            await orchestrator.delegateTask(task, 'frontend');

            expect((agentManager.spawnAgent as sinon.SinonStub).calledOnce).to.be.true;

            const call = (agentManager.spawnAgent as sinon.SinonStub).firstCall;
            expect(call.args[0]).to.have.property('type', 'frontend');
        });

        it('should delegate backend tasks to backend agent', async () => {
            orchestrator.setAgentManager(agentManager);

            const task = 'Add a new API endpoint for user profile';
            await orchestrator.delegateTask(task, 'backend');

            expect((agentManager.spawnAgent as sinon.SinonStub).calledOnce).to.be.true;

            const call = (agentManager.spawnAgent as sinon.SinonStub).firstCall;
            expect(call.args[0]).to.have.property('type', 'backend');
        });

        it('should not exceed max concurrent agents', async () => {
            orchestrator.setAgentManager(agentManager);

            // Try to spawn 10 agents (max is 6)
            const tasks = Array.from({ length: 10 }, (_, i) => `Task ${i}`);

            for (const task of tasks) {
                await orchestrator.delegateTask(task, 'general');
            }

            // Should only spawn up to 6 agents
            const spawnCount = (agentManager.spawnAgent as sinon.SinonStub).callCount;
            expect(spawnCount).to.be.at.most(6);
        });
    });

    describe('Error Handling', () => {
        it('should retry failed tasks up to 3 times', async () => {
            orchestrator.setAgentManager(agentManager);

            // Mock agent failure
            const spawnStub = agentManager.spawnAgent as sinon.SinonStub;
            spawnStub.rejects(new Error('Agent failed'));

            const task = 'Build the project';

            try {
                await orchestrator.executeTaskWithRetry(task, 'general');
            } catch (e) {
                // Expected to fail after retries
            }

            // Should attempt 3 times (initial + 2 retries)
            expect(spawnStub.callCount).to.equal(3);
        });

        it('should handle agent stuck events', (done) => {
            orchestrator.on('agentStuck', (event) => {
                expect(event).to.have.property('agentId');
                expect(event).to.have.property('reason');
                expect(event).to.have.property('suggestion');
                done();
            });

            // Simulate stuck event
            orchestrator.handleAgentStuck({
                agentId: 'test-agent',
                reason: 'Infinite loop detected',
                evidence: ['Repeated action 10 times'],
                suggestion: 'Try a different approach'
            } as any);
        });
    });

    describe('Memory Integration', () => {
        it('should store completed tasks in memory', async () => {
            const task = 'Implement user authentication';
            await orchestrator.recordTaskCompletion(task, {
                success: true,
                duration: 5000,
                agentType: 'backend'
            });

            const memories = await semanticMemory.search('authentication', 5);
            expect(memories).to.be.an('array');
            expect(memories.length).to.be.greaterThan(0);
        });

        it('should learn from failed attempts', async () => {
            const task = 'Deploy to production';
            await orchestrator.recordTaskFailure(task, {
                error: 'Missing environment variables',
                attempts: 3,
                agentType: 'general'
            });

            const lessons = await orchestratorMemory.getFailurePatterns();
            expect(lessons).to.be.an('array');
        });

        it('should retrieve relevant context for similar tasks', async () => {
            // Record previous task
            await orchestrator.recordTaskCompletion('Build React component', {
                success: true,
                duration: 3000,
                agentType: 'frontend'
            });

            // Request similar task
            const context = await orchestrator.getRelevantContext('Create new React component');

            expect(context).to.be.an('array');
        });
    });

    describe('Progress Tracking', () => {
        it('should emit progress events', (done) => {
            orchestrator.on('progress', (event) => {
                expect(event).to.have.property('phase');
                expect(event).to.have.property('progress');
                done();
            });

            orchestrator.reportProgress('Planning', 0.25);
        });

        it('should track overall task completion percentage', async () => {
            const plan = {
                steps: [
                    { description: 'Step 1', completed: true },
                    { description: 'Step 2', completed: true },
                    { description: 'Step 3', completed: false },
                    { description: 'Step 4', completed: false }
                ],
                requiredAgents: ['frontend']
            };

            const progress = orchestrator.calculateProgress(plan);
            expect(progress).to.equal(0.5); // 2/4 = 50%
        });
    });
});
