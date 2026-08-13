import { useEffect } from 'react';

/**
 * Custom hook to set document title dynamically.
 * Automatically appends the product suffix.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | Conversinha`;

    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
