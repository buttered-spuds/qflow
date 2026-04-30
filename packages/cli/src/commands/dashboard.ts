import chalk from 'chalk';
import { createServer } from 'http';
import { readFile, readdir } from 'fs/promises';
import { join, extname } from 'path';
import { existsSync } from 'fs';

interface DashboardOptions {
  port: string;
}

export async function dashboardCommand(options: DashboardOptions): Promise<void> {
  const port = parseInt(options.port, 10);
  const cwd = process.cwd();
  const dataDir = join(cwd, '.qflow', 'data');

  if (!existsSync(dataDir)) {
    console.log(chalk.yellow('\n  No run data found yet. Run: npx qflow run\n'));
    return;
  }

  console.log(chalk.bold.cyan(`\n  qflow dashboard\n`));
  console.log(chalk.dim(`  Serving run data from .qflow/data/`));
  console.log(`\n  Dashboard: ${chalk.cyan(`http://localhost:${port}`)}\n`);
  console.log(chalk.dim('  Press Ctrl+C to stop\n'));

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';

    // Serve run data as JSON API
    if (url === '/api/manifest') {
      try {
        const files = (await readdir(dataDir)).filter((f) => f.endsWith('.json'));
        const runs = await Promise.all(
          files.sort().reverse().map(async (f) => {
            const raw = await readFile(join(dataDir, f), 'utf-8');
            return JSON.parse(raw);
          }),
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ runs }));
      } catch {
        res.writeHead(500);
        res.end('Error reading run data');
      }
      return;
    }

    // Serve the static dashboard HTML
    const dashboardPath = join(
      new URL(import.meta.url).pathname,
      '../../../../dashboard/index.html',
    );

    if (existsSync(dashboardPath)) {
      const html = await readFile(dashboardPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } else {
      // Fallback minimal dashboard when dashboard/ isn't built
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(buildFallbackDashboard(port));
    }
  });

  server.listen(port);
}

function buildFallbackDashboard(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>qflow dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; background: #0d1117; color: #e6edf3; }
    h1 { color: #58a6ff; }
    .run { border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin: 12px 0; }
    .passed { color: #3fb950; }
    .failed { color: #f85149; }
    .meta { color: #8b949e; font-size: 0.85em; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    td, th { padding: 8px 12px; text-align: left; border-bottom: 1px solid #21262d; font-size: 0.9em; }
    th { color: #8b949e; font-weight: 500; }
  </style>
</head>
<body>
  <h1>qflow dashboard</h1>
  <div id="app"><p>Loading…</p></div>
  <script>
    async function load() {
      const res = await fetch('/api/manifest');
      const { runs } = await res.json();
      const app = document.getElementById('app');
      if (!runs.length) { app.innerHTML = '<p>No runs yet. Run: <code>npx qflow run</code></p>'; return; }
      app.innerHTML = runs.map(r => \`
        <div class="run">
          <strong>\${r.suite}</strong>
          <span class="passed"> ✓ \${r.passed} passed</span>
          \${r.failed ? \`<span class="failed"> ✗ \${r.failed} failed</span>\` : ''}
          <span class="meta"> · \${r.runner} · \${new Date(r.timestamp).toLocaleString()} · \${r.duration}ms</span>
          <table>
            <tr><th>Test</th><th>Status</th><th>Duration</th></tr>
            \${r.tests.map(t => \`<tr><td>\${t.fullName}</td><td class="\${t.status}">\${t.status}</td><td>\${t.duration}ms</td></tr>\`).join('')}
          </table>
        </div>
      \`).join('');
    }
    load();
    setInterval(load, 10000);
  </script>
</body>
</html>`;
}
