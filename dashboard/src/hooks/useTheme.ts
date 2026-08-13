import { useEffect } from 'react';

export type Theme = 'light' | 'dark' | 'system';

export function useTheme() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('openwa_theme', 'light');
  }, []);

  const setTheme = (newTheme: Theme) => {
    if (newTheme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  };
  const toggleTheme = () => undefined;

  return { theme: 'light' as const, setTheme, toggleTheme, resolvedTheme: 'light' as const };
}
