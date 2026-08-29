#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, resolve } from "node:path";

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "section";
}

function markdownToHtml(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const sections = [];
  const output = [];
  let listType = null;
  let inCode = false;
  let codeLanguage = "";
  let codeLines = [];

  const closeList = () => {
    if (!listType) return;
    output.push(`</${listType}>`);
    listType = null;
  };

  for (const line of lines) {
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      closeList();
      if (!inCode) {
        inCode = true;
        codeLanguage = fence[1].trim();
        codeLines = [];
      } else {
        output.push(`<pre data-language="${escapeHtml(codeLanguage)}"><button class="copy-code" type="button">Copy</button><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inCode = false;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slugify(text);
      if (level === 2) sections.push({ id, text });
      output.push(`<h${level} id="${id}">${inlineMarkdown(text)}</h${level}>`);
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      const nextType = unordered ? "ul" : "ol";
      if (listType !== nextType) {
        closeList();
        listType = nextType;
        output.push(`<${listType}>`);
      }
      output.push(`<li>${inlineMarkdown((unordered ?? ordered)[1])}</li>`);
      continue;
    }

    closeList();
    if (!line.trim()) continue;
    if (/^---+$/.test(line.trim())) {
      output.push("<hr>");
    } else if (line.startsWith("> ")) {
      output.push(`<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>`);
    } else {
      output.push(`<p>${inlineMarkdown(line.trim())}</p>`);
    }
  }

  closeList();
  if (inCode) {
    output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }

  return { body: output.join("\n"), sections };
}

function pageTemplate(title, rendered) {
  const nav = rendered.sections
    .map(({ id, text }) => `<a href="#${id}">${escapeHtml(text)}</a>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light; --bg:#f6f7f9; --panel:#fff; --text:#18202b; --muted:#637083; --line:#dce1e8; --accent:#5b5bd6; --accent-soft:#eeeeff; --code:#111827; --shadow:0 12px 32px rgba(26,32,44,.08); }
:root[data-theme="dark"] { color-scheme:dark; --bg:#111319; --panel:#191c24; --text:#edf0f7; --muted:#9ca7b8; --line:#303541; --accent:#a5a6ff; --accent-soft:#292943; --code:#0c0e13; --shadow:none; }
* { box-sizing:border-box; }
html { scroll-behavior:smooth; }
body { margin:0; background:var(--bg); color:var(--text); font:16px/1.65 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
.progress { position:fixed; inset:0 0 auto; height:3px; background:linear-gradient(90deg,var(--accent) var(--progress,0%),transparent 0); z-index:5; }
.layout { display:grid; grid-template-columns:240px minmax(0,860px); gap:42px; max-width:1180px; margin:auto; padding:42px 24px 80px; }
aside { position:sticky; top:32px; align-self:start; max-height:calc(100vh - 64px); overflow:auto; }
.brand { font-size:12px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); margin-bottom:18px; }
nav { display:grid; gap:4px; }
nav a { color:var(--muted); text-decoration:none; padding:7px 10px; border-radius:8px; font-size:14px; }
nav a:hover { color:var(--text); background:var(--accent-soft); }
.actions { display:flex; gap:8px; margin-top:20px; }
button { border:1px solid var(--line); background:var(--panel); color:var(--text); border-radius:8px; padding:7px 10px; cursor:pointer; }
main { min-width:0; background:var(--panel); border:1px solid var(--line); border-radius:18px; padding:clamp(24px,5vw,64px); box-shadow:var(--shadow); }
h1 { font-size:clamp(34px,6vw,58px); line-height:1.05; letter-spacing:-.04em; margin:0 0 28px; }
h2 { font-size:27px; line-height:1.2; margin:54px 0 16px; padding-top:8px; border-top:1px solid var(--line); }
h3 { font-size:19px; margin:30px 0 8px; }
h4 { font-size:16px; margin:24px 0 6px; }
p { margin:10px 0; }
ul,ol { padding-left:24px; }
li { margin:7px 0; }
strong { font-weight:750; }
code { font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--accent-soft); border-radius:5px; padding:2px 5px; }
pre { position:relative; overflow:auto; background:var(--code); color:#e5e7eb; border-radius:12px; padding:20px; }
pre code { padding:0; background:none; color:inherit; }
.copy-code { position:absolute; top:8px; right:8px; border-color:#374151; background:#1f2937; color:#e5e7eb; font-size:12px; }
blockquote { margin:18px 0; padding:12px 16px; border-left:4px solid var(--accent); background:var(--accent-soft); border-radius:0 8px 8px 0; }
hr { border:0; border-top:1px solid var(--line); margin:36px 0; }
footer { color:var(--muted); font-size:12px; margin-top:54px; }
@media (max-width:800px) { .layout { display:block; padding:16px; } aside { position:static; margin:10px 0 24px; } nav { display:none; } main { padding:28px 22px; } }
@media print { body { background:white; } .layout { display:block; max-width:none; padding:0; } aside,.progress,.copy-code { display:none; } main { border:0; box-shadow:none; padding:0; } }
</style>
</head>
<body>
<div class="progress" aria-hidden="true"></div>
<div class="layout">
<aside>
<div class="brand">Generated report</div>
<nav>${nav}</nav>
<div class="actions"><button id="theme" type="button">Theme</button><button onclick="print()" type="button">Print</button></div>
</aside>
<main>${rendered.body}<footer>Generated locally · ${new Date().toISOString()}</footer></main>
</div>
<script>
const root=document.documentElement;
document.querySelector('#theme').addEventListener('click',()=>{const dark=root.dataset.theme==='dark';root.dataset.theme=dark?'':'dark';localStorage.setItem('report-theme',root.dataset.theme)});
root.dataset.theme=localStorage.getItem('report-theme')||'';
document.querySelectorAll('.copy-code').forEach(button=>button.addEventListener('click',async()=>{await navigator.clipboard.writeText(button.nextElementSibling.textContent);button.textContent='Copied';setTimeout(()=>button.textContent='Copy',1200)}));
addEventListener('scroll',()=>{const max=document.documentElement.scrollHeight-innerHeight;document.querySelector('.progress').style.setProperty('--progress',max?\`\${Math.min(100,scrollY/max*100)}%\`:'100%')},{passive:true});
</script>
</body>
</html>`;
}

const input = process.argv[2];
if (!input) {
  console.error("Usage: render-report.mjs <report.md> [output.html]");
  process.exit(2);
}

const markdown = readFileSync(resolve(input), "utf8");
const firstHeading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
const title = firstHeading || basename(input, extname(input));
const rendered = markdownToHtml(markdown);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const defaultOutput = resolve(homedir(), ".pi", "agent", "generated-html", `${slugify(title)}-${timestamp}.html`);
const output = resolve(process.argv[3] || defaultOutput);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, pageTemplate(title, rendered), { encoding: "utf8", flag: "wx" });
console.log(output);
