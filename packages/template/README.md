# qflow template

Starter project for greenfield repos using qflow. Clone or copy this directory to bootstrap a new project with Playwright UI + API testing and qflow configured out of the box.

---

## What's included

```
template/
├── framework.config.ts          qflow config (all optional sections commented out)
├── playwright.config.ts         Playwright config with JSON reporter
├── package.json                 npm scripts wired to qflow
├── tests/
│   ├── ui/
│   │   └── example.spec.ts      Example Playwright UI test (@smoke tagged)
│   └── api/
│       └── example.spec.ts      Example Playwright API test (no browser)
└── scripts/
    └── setup-env.sh             Hook for Docker / DB / seed setup before tests
```

---

## Getting started

```bash
# Copy the template into your project
cp -r packages/template my-project
cd my-project

# Install dependencies
npm install

# Run tests locally (no notifications)
npm run test:local

# Or with full qflow output
npx @qflow/cli run
```

---

## Available scripts

| Script | Description |
|---|---|
| `npm test` | `npx @qflow/cli run` — full run with notifications |
| `npm run test:smoke` | `npx @qflow/cli run --suite smoke` — @smoke tagged tests only |
| `npm run test:local` | `npx @qflow/cli run --local` — offline, no notifications |

---

## Enabling integrations

Edit `framework.config.ts` and uncomment the sections you need:

```ts
// Uncomment to enable JIRA integration:
jira: {
  url: process.env.QFLOW_JIRA_URL!,
  token: process.env.QFLOW_JIRA_TOKEN!,
  project: 'PROJ',
},

// Uncomment to enable AI test generation (Phase 3):
llm: {
  provider: 'openai',
  apiKey: process.env.QFLOW_LLM_API_KEY!,
  model: 'gpt-4o',
},
```

---

## Environment setup

Edit `scripts/setup-env.sh` to add your environment setup steps before tests run:

```bash
# Example: start Docker Compose
docker compose -f docker-compose.test.yml up -d --wait

# Example: run DB migrations
npx prisma migrate deploy
```

The Runner Agent calls `npx playwright test` — it does not manage environment setup. The script runs first, tests run second.

---

## Writing tests

### UI tests (`tests/ui/`)
Standard Playwright tests. Tag with `@smoke` to include in the smoke suite:

```ts
test('login works @smoke', async ({ page }) => {
  await page.goto('/login');
  await page.fill('[name=email]', 'user@example.com');
  await page.click('[type=submit]');
  await expect(page).toHaveURL('/dashboard');
});
```

### API tests (`tests/api/`)
Use Playwright's `request` context — no browser launched, very fast:

```ts
test('POST /api/orders returns 201 @smoke', async ({ request }) => {
  const res = await request.post('/api/orders', {
    data: { item: 'widget', qty: 1 },
  });
  expect(res.status()).toBe(201);
});
```
