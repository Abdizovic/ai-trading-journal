# Project documentation

**Output:** `AI_Trading_Journal_Documentation.pdf`. Open it in VS Code with your PDF viewer extension.

The PDF is generated. Don't edit it directly; change the inputs below and rebuild:

```bash
cd docs
npm run build          # regenerates the PDF (about 30 seconds)
```

## 1. Your details: `config.json`

Replace `YOUR FULL NAME`, `BSCS/20XX/XXXXX`, `SUPERVISOR NAME`, `submissionDate` and `repositoryUrl`.

> **Survey data:** the numbers under `survey` are **sample values** used to lay out the Chapter 4 charts and tables. Replace them with the real results of your own interviews and questionnaires before you submit.

## 2. Your screenshots: `your-screenshots/`

Save each image (PNG or JPG) with **exactly** this name, then run `npm run build`. The placeholder box is replaced automatically.

| File name | Where it appears | What to capture |
|---|---|---|
| `vscode.png` | Figure 6.1 | VS Code with the project open |
| `expo-go-device.png` | Figure 6.2 | The app running on your phone in Expo Go |
| `supabase-dashboard.png` | Figure 6.3 | Supabase Table Editor or Authentication → Users |
| `github-repository.png` | Appendix A.4 | Your GitHub repository page |
| `plagiarism-report.png` | Appendix A.5 | Your similarity report |

## 3. App screenshots: `screenshots/`

These were captured from the live app. To re-capture them after UI changes, run `npm run screenshots`. It rebuilds the web version and signs in with the demo accounts.

## How it works

- `build/content.mjs` holds the document text; each chapter follows the section structure of the reference report.
- `build/build.mjs` renders the HTML to PDF in Chrome. It runs two passes, so the Table of Contents, List of Figures and List of Tables get the correct page numbers. It then stamps roman page numbers on the front matter and arabic numbers from Chapter One.
- The diagrams are drawn from the real deployed schema: the ERD, use case and architecture diagrams are custom SVG in `build/uml.mjs`, and the class, sequence and activity diagrams are Mermaid.
- `build/schema.json` is a snapshot of the live database structure used by the schema figures.
- `node build/preview.mjs 1-5` renders pages to PNG so you can check them.
