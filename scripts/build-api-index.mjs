import fs from 'node:fs';
import path from 'node:path';

// Usage (from the repo root): node scripts/build-api-index.mjs
// Rebuilds docs/api/planned-endpoints.md from the endpoint tables in docs/api/F??-*.md and lists any endpoint
// named in a feature spec that is missing from the API docs.
const root = process.argv[2] ?? process.cwd();
const apiDir = path.join(root, 'docs', 'api');
const files = fs.readdirSync(apiDir).filter((f) => /^F\d\d-.*\.md$/.test(f)).sort();

const norm = (method, p) => `${method} ${p.replace(/\?.*$/, '').replace(/:[A-Za-z]+/g, ':p')}`;

const titles = {};
const byFeature = [];
const seen = new Map(); // normalized -> first feature
const problems = [];

for (const file of files) {
  const text = fs.readFileSync(path.join(apiDir, file), 'utf8').replace(/\r\n/g, '\n');
  const fid = file.slice(0, 3);
  const title = (text.match(/^# API · (F\d\d) (.+)$/m) || [])[2] ?? file;
  titles[fid] = title;
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\| `(GET|POST|PUT|PATCH|DELETE)` \| `([^`]+)` \| ([^|]+) \| ([^|]+) \|$/);
    if (!m) continue;
    const [, method, p, auth, purpose] = m;
    const key = norm(method, p);
    const first = seen.get(key);
    if (!first) seen.set(key, fid);
    rows.push({ method, path: p, auth: auth.trim(), purpose: purpose.trim(), dup: first && first !== fid ? first : null });

    // sanity: the path (or its last segment) is described somewhere outside the table row
    const body = text.split('\n').filter((l) => !l.startsWith('|')).join('\n');
    const last = p.split('/').filter(Boolean).pop();
    if (!body.includes(p) && !body.includes(last)) problems.push(`${fid} ${method} ${p}: no detail text found`);
  }
  byFeature.push({ fid, file, title, rows });
}

// ---- cross-check against the original feature docs ----
const docFiles = [];
for (const dir of ['foundation', 'catalog', 'customer', 'orders', 'delivery', 'platform']) {
  for (const f of fs.readdirSync(path.join(root, 'docs', dir))) docFiles.push(path.join(root, 'docs', dir, f));
}
const missing = [];
for (const f of docFiles) {
  const text = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  for (const m of text.matchAll(/`(GET|POST|PUT|PATCH|DELETE) (\/[^` ]+)`/g)) {
    const key = norm(m[1], m[2]);
    if (!seen.has(key)) missing.push(`${path.basename(f)}: ${m[1]} ${m[2]}`);
  }
}

// ---- write the index ----
const total = seen.size;
let out = `# API Reference

Status: draft v1 · Generated from the per-feature files in this folder · **${total} endpoints** across ${byFeature.length} features

Start with [00-conventions.md](00-conventions.md) (envelopes, auth, errors, pagination, idempotency, polling). Then open the file for the feature you are building: each endpoint shows who can call it, the request, example success responses and the errors to handle, so the apps can be built and compared against the backend.

**Auth column:** \`Public\` no token · \`Auth\` any logged-in user · \`Customer\` · \`Rider\` · \`Admin perm\` staff with that permission key · \`Webhook\` provider signature · \`Token link\` expiring public link.

## Feature files

| Feature | File | Endpoints |
|---|---|---|
${byFeature.map((f) => `| ${f.fid} ${f.title} | [${f.file}](${f.file}) | ${f.rows.length} |`).join('\n')}

## All endpoints

\`↗ Fxx\` means the endpoint is also listed in another feature file (the first one is where it is described).

`;
for (const f of byFeature) {
  out += `### ${f.fid} · ${f.title}\n\n| Method | Path | Auth | Purpose |\n|---|---|---|---|\n`;
  for (const r of f.rows) {
    const note = r.dup ? ` ↗ ${r.dup}` : '';
    out += `| \`${r.method}\` | \`${r.path}\` | ${r.auth} | ${r.purpose}${note} |\n`;
  }
  out += '\n';
}
out += `## How the apps use this folder

- **Customer app:** F01 login, F03 location, F08 browse, F09 addresses, F10 cart and quote, F13 place order, F15 payments, F16 cancel and refund, F20 tracking, F07 Notify Me, F12 coupons, F17 pre-orders, F23 push payloads, F24 uploads.
- **Rider app:** F01 login (\`app: "rider"\`), F19 shifts and delivery, F20 location, F21 bundle and offline sync, F22 cash, F23 push payloads, F24 uploads.
- **Web admin:** every \`/admin/*\` endpoint, grouped by feature as in the table above.
- **Backend:** build each feature's endpoints in the order of the backend plan; the response examples are the contract the apps compare against.
`;
// The index lives in planned-endpoints.md. README.md is the hand-written reference for implemented routes
// and is never touched. Keep whatever preface already sits above the generated "Status:" line.
const target = path.join(apiDir, 'planned-endpoints.md');
let preface = '# Proposed API endpoint catalog\n\n';
if (fs.existsSync(target)) {
  const old = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  const i = old.indexOf('Status: draft v1');
  if (i > 0) preface = old.slice(0, i);
}
out = out.replace(/^# API Reference\n\n/, preface);
fs.writeFileSync(target, out);

console.log(`features: ${byFeature.length}, unique endpoints: ${total}`);
console.log(byFeature.map((f) => `${f.fid}:${f.rows.length}`).join(' '));
console.log(`detail-text problems: ${problems.length}`);
problems.forEach((p) => console.log('  ' + p));
console.log(`endpoints named in feature docs but missing from API docs: ${missing.length}`);
[...new Set(missing)].forEach((m) => console.log('  ' + m));
