/**
 * @file src/features/nomination/preview-document.ts
 * Purpose: Render parser output only inside an iframe with an empty sandbox attribute.
 *
 * Table of contents:
 * 1. createPreviewDocument
 */

export function createPreviewDocument(html: string): string {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'">
<style>
body {
    margin: 16px;
    background: #fff;
    color: #202122;
    font: 14px/1.6 sans-serif;
    overflow-wrap: anywhere;
}
a { color: #36c; }
table { border-collapse: collapse; max-width: 100%; }
.wikitable {
    margin: 1em 0;
    border: 1px solid #a2a9b1;
    background: #f8f9fa;
}
.wikitable > tr > th, .wikitable > tr > td,
.wikitable > tbody > tr > th, .wikitable > tbody > tr > td {
    border: 1px solid #a2a9b1;
    padding: 0.3em 0.6em;
}
.wikitable th { background: #eaecf0; }
img { max-width: 100%; height: auto; }
pre { white-space: pre-wrap; }
</style>
</head>
<body class="mw-parser-output">${html}</body>
</html>`;
}
