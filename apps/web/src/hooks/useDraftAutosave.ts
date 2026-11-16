import { useEffect, useState, useCallback } from 'react';

/**
 * Persists unsaved draft state to localStorage keyed by draftKey so page reloads
 * or connection drops never lose in-progress entries.
 */
export function useDraftAutosave<T>(draftKey: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        return { ...initialValue, ...(JSON.parse(saved) as Partial<T>) };
      }
    } catch {
      // Ignore storage errors
    }
    return initialValue;
  });

  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(value));
    } catch {
      // Ignore quota errors
    }
  }, [draftKey, value]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // Ignore
    }
    setValue(initialValue);
  }, [draftKey, initialValue]);

  return [value, setValue, clearDraft] as const;
}
