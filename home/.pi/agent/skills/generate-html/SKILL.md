---
name: generate-html
description: Creates a polished, standalone local HTML page from an explanation, architecture walkthrough, feature description, review, or other requested content. Use when the user asks for an HTML report, visual document, browsable explanation, or invokes /generate-html.
compatibility: Requires Node.js 20 or newer and a local browser to open the result automatically.
---

# Generate HTML

Create an accurate Markdown report, render it with the bundled dependency-free script, and give the user the resulting local HTML path.

## Workflow

1. Interpret the user's request and inspect any referenced code or documentation before writing. Do not invent architecture or implementation details.
2. Structure the report for scanning:
   - one `#` title;
   - a short executive summary;
   - descriptive `##` sections;
   - `###` subsections, bullets, and fenced code where useful;
   - a final sources/evidence section when the report is based on code.
3. Write the Markdown source to a temporary file. Do not place generated reports in the repository unless the user explicitly requests that.
4. Resolve this skill's directory from the loaded `SKILL.md`, then run:

   ```sh
   node <skill-directory>/scripts/render-report.mjs <temporary-report.md>
   ```

   The script prints the generated path and defaults to `~/.pi/agent/generated-html/<title>-<timestamp>.html`. It refuses to overwrite an existing page.
5. Verify the output exists, is an HTML document, and contains the report title. Never claim visual correctness without opening or inspecting it.
6. When a desktop session is available, open the page with `open <path>` on macOS or `xdg-open <path>` on Linux. Otherwise return the absolute path and a `file://` URL.
7. Summarize what the page contains in one or two sentences.

## Content rules

- The HTML is a presentation layer, not a substitute for analysis.
- Distinguish facts, inferences, and recommendations.
- Cite repository evidence with file paths and line numbers when available.
- Do not embed credentials, environment values, private source, or sensitive tool output.
- Keep the page self-contained: no CDN, remote font, analytics, or network dependency.
- Prefer concise sections over decorative filler.

## Renderer behavior

The renderer escapes raw HTML from the Markdown source, supports headings, paragraphs, ordered and unordered lists, blockquotes, inline emphasis/code, and fenced code blocks. The generated page includes responsive navigation, light/dark themes, print styling, reading progress, and code-copy buttons.
