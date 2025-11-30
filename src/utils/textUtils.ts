/**
 * Shared text utilities
 * Extracted to avoid code duplication across memory modules
 */

// Common stop words for keyword extraction
const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
    'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
    'from', 'as', 'into', 'through', 'during', 'before', 'after',
    'above', 'below', 'between', 'under', 'again', 'further', 'then',
    'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
    'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
    'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just'
]);

/**
 * Extract keywords from content for semantic matching
 * @param content - Text to extract keywords from
 * @param maxKeywords - Maximum number of keywords to return (default 20)
 */
export function extractKeywords(content: string, maxKeywords: number = 20): string[] {
    return content
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2 && !STOP_WORDS.has(word))
        .slice(0, maxKeywords);
}

/**
 * Debounce a function - prevents rapid repeated calls
 * @param fn - Function to debounce
 * @param waitMs - Milliseconds to wait before executing
 */
export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    waitMs: number
): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout | null = null;
    
    return (...args: Parameters<T>) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            fn(...args);
            timeoutId = null;
        }, waitMs);
    };
}

/**
 * Throttle a function - limits how often it can be called
 * @param fn - Function to throttle
 * @param limitMs - Minimum milliseconds between calls
 */
export function throttle<T extends (...args: any[]) => any>(
    fn: T,
    limitMs: number
): (...args: Parameters<T>) => void {
    let lastCall = 0;
    let pendingArgs: Parameters<T> | null = null;
    let timeoutId: NodeJS.Timeout | null = null;

    return (...args: Parameters<T>) => {
        const now = Date.now();
        const timeSinceLastCall = now - lastCall;

        if (timeSinceLastCall >= limitMs) {
            lastCall = now;
            fn(...args);
        } else {
            // Store latest args and schedule execution
            pendingArgs = args;
            if (!timeoutId) {
                timeoutId = setTimeout(() => {
                    lastCall = Date.now();
                    if (pendingArgs) {
                        fn(...pendingArgs);
                        pendingArgs = null;
                    }
                    timeoutId = null;
                }, limitMs - timeSinceLastCall);
            }
        }
    };
}
