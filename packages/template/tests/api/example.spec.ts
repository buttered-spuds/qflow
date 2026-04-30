import { test, expect, request } from '@playwright/test';

// Example API test using Playwright's request context.
// These run without a browser — fast and lightweight.

test.use({ baseURL: process.env.API_BASE_URL ?? 'http://localhost:3001' });

test('GET /health returns 200 @smoke', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.status()).toBe(200);
});

test('GET /api/users returns array', async ({ request }) => {
  const res = await request.get('/api/users');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});
