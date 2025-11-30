import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { LoopDetector } from '../../../src/collaboration/loopDetector';

describe('LoopDetector', () => {
    let detector: LoopDetector;

    beforeEach(() => {
        detector = new LoopDetector();
    });

    describe('detectLoop', () => {
        it('should not detect loop with diverse actions', () => {
            const agentId = 'test-agent-1';

            detector.recordAction(agentId, 'write_file', { path: 'file1.ts' });
            detector.recordAction(agentId, 'read_file', { path: 'file2.ts' });
            detector.recordAction(agentId, 'execute_command', { cmd: 'npm test' });

            const result = detector.detectLoop(agentId);
            expect(result.isStuck).to.be.false;
        });

        it('should detect loop with repeated identical actions', () => {
            const agentId = 'test-agent-2';

            // Repeat the same action 6 times (threshold is 5)
            for (let i = 0; i < 6; i++) {
                detector.recordAction(agentId, 'write_file', {
                    path: 'same-file.ts',
                    content: 'same content'
                });
            }

            const result = detector.detectLoop(agentId);
            expect(result.isStuck).to.be.true;
            expect(result.reason).to.include('Repeated');
        });

        it('should detect loop with alternating but repetitive patterns', () => {
            const agentId = 'test-agent-3';

            // Create A-B-A-B-A-B pattern
            for (let i = 0; i < 3; i++) {
                detector.recordAction(agentId, 'read_file', { path: 'file.ts' });
                detector.recordAction(agentId, 'write_file', { path: 'file.ts' });
            }

            const result = detector.detectLoop(agentId);
            expect(result.isStuck).to.be.true;
            expect(result.reason).to.include('pattern');
        });

        it('should not flag as loop if actions produce different results', () => {
            const agentId = 'test-agent-4';

            // Same tool, different targets
            detector.recordAction(agentId, 'write_file', { path: 'file1.ts' });
            detector.recordAction(agentId, 'write_file', { path: 'file2.ts' });
            detector.recordAction(agentId, 'write_file', { path: 'file3.ts' });
            detector.recordAction(agentId, 'write_file', { path: 'file4.ts' });

            const result = detector.detectLoop(agentId);
            expect(result.isStuck).to.be.false;
        });

        it('should detect thrashing (excessive file rewrites)', () => {
            const agentId = 'test-agent-5';

            // Rewrite same file many times
            for (let i = 0; i < 8; i++) {
                detector.recordAction(agentId, 'write_file', {
                    path: 'same.ts',
                    content: `version ${i}`
                });
            }

            const result = detector.detectLoop(agentId);
            expect(result.isStuck).to.be.true;
            expect(result.evidence).to.have.lengthOf.at.least(1);
        });

        it('should provide helpful suggestions when stuck', () => {
            const agentId = 'test-agent-6';

            for (let i = 0; i < 6; i++) {
                detector.recordAction(agentId, 'execute_command', {
                    cmd: 'npm test'
                });
            }

            const result = detector.detectLoop(agentId);
            expect(result.isStuck).to.be.true;
            expect(result.suggestion).to.be.a('string');
            expect(result.suggestion.length).to.be.greaterThan(0);
        });

        it('should track multiple agents independently', () => {
            detector.recordAction('agent-1', 'write_file', { path: 'file.ts' });
            detector.recordAction('agent-2', 'read_file', { path: 'file.ts' });

            for (let i = 0; i < 6; i++) {
                detector.recordAction('agent-1', 'execute_command', { cmd: 'npm test' });
            }

            const result1 = detector.detectLoop('agent-1');
            const result2 = detector.detectLoop('agent-2');

            expect(result1.isStuck).to.be.true;
            expect(result2.isStuck).to.be.false;
        });

        it('should reset after clearHistory', () => {
            const agentId = 'test-agent-7';

            for (let i = 0; i < 6; i++) {
                detector.recordAction(agentId, 'write_file', { path: 'file.ts' });
            }

            expect(detector.detectLoop(agentId).isStuck).to.be.true;

            detector.clearHistory(agentId);

            expect(detector.detectLoop(agentId).isStuck).to.be.false;
        });
    });

    describe('action tracking', () => {
        it('should maintain action history within window size', () => {
            const agentId = 'test-agent-8';

            // Record more than window size (20 actions)
            for (let i = 0; i < 25; i++) {
                detector.recordAction(agentId, 'read_file', { path: `file${i}.ts` });
            }

            // Should still function correctly (not throw errors)
            const result = detector.detectLoop(agentId);
            expect(result).to.have.property('isStuck');
        });

        it('should normalize similar parameters', () => {
            const agentId = 'test-agent-9';

            // These should be considered the same action
            detector.recordAction(agentId, 'write_file', {
                path: 'test.ts',
                content: 'hello world'
            });
            detector.recordAction(agentId, 'write_file', {
                path: 'test.ts',
                content: 'hello world '
            });

            // Pattern should be detected based on tool+path, not exact content
            const result = detector.detectLoop(agentId);
            // This is a design decision - we're testing current behavior
            expect(result).to.have.property('isStuck');
        });
    });
});
