import '@testing-library/jest-dom/vitest';

// jsdom has no layout, so scrolling is a no-op in tests.
if (typeof window !== 'undefined') window.scrollTo = () => undefined;
