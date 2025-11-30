import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // Allow unused vars prefixed with underscore
            '@typescript-eslint/no-unused-vars': ['error', { 
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
            }],
            // Allow explicit any - we interface with dynamic LLM output
            '@typescript-eslint/no-explicit-any': 'off',
            // Allow require() in specific cases
            '@typescript-eslint/no-require-imports': 'off',
            // Allow empty functions for dispose patterns
            '@typescript-eslint/no-empty-function': 'off',
            // Allow empty object types
            '@typescript-eslint/no-empty-object-type': 'off',
            // Prefer const
            'prefer-const': 'error',
            // No console - but we use outputChannel
            'no-console': 'off',
            // Allow empty catch blocks (common pattern for optional operations)
            'no-empty': ['error', { allowEmptyCatch: true }],
            // Allow lexical declarations in case blocks (common pattern)
            'no-case-declarations': 'off',
            // Allow useless escapes (regex patterns can be complex)
            'no-useless-escape': 'warn',
        },
    },
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'src/_legacy/**',
            '**/*.js',
            '**/*.mjs',
        ],
    }
);
