/**
 * Testing Module - Barrel Export
 *
 * Comprehensive testing system for:
 * - NEW apps (via AppBuilder)
 * - EXISTING apps (via codebase analysis)
 */

export { CodebaseAnalyzer, CodebaseStructure, ComponentInfo, APIEndpoint, UtilityFunction, DatabaseModel } from './codebaseAnalyzer';
export { TestGenerator, GeneratedTest } from './testGenerator';
