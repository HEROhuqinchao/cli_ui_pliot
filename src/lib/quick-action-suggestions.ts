const SUCCESS_TTL_MS = 10 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;

interface Entry {
  workspace: string;
  suggestions: string[];
  expiresAt: number;
  pending?: Promise<string[]>;
}

/** One bounded workspace slot; stale completions cannot overwrite a new workspace. */
export function createQuickActionSuggestionsCache(now: () => number = Date.now) {
  let current: Entry | undefined;
  return {
    get(workspace: string, generate: () => Promise<string[]>): Promise<string[]> {
      if (current?.workspace === workspace) {
        if (current.pending) return current.pending;
        if (now() < current.expiresAt) return Promise.resolve(current.suggestions);
      }
      const entry: Entry = { workspace, suggestions: [], expiresAt: 0 };
      current = entry;
      entry.pending = Promise.resolve().then(generate).then((suggestions) => {
        entry.suggestions = suggestions;
        entry.expiresAt = now() + (suggestions.length ? SUCCESS_TTL_MS : FAILURE_TTL_MS);
        return suggestions;
      }, () => {
        // Empty dynamic suggestions are a static-only fallback, not a fake AI result.
        entry.expiresAt = now() + FAILURE_TTL_MS;
        return [];
      }).finally(() => { entry.pending = undefined; });
      return entry.pending;
    },
  };
}

const state = globalThis as typeof globalThis & {
  __codepilotQuickActionSuggestionsV2?: ReturnType<typeof createQuickActionSuggestionsCache>;
};
export const quickActionSuggestions = state.__codepilotQuickActionSuggestionsV2
  ??= createQuickActionSuggestionsCache();
