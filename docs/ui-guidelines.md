# UI guidelines

<!-- toc:start -->

## Contents

- [Required references](#required-references)
- [Links and buttons](#links-and-buttons)
- [Action hierarchy and order](#action-hierarchy-and-order)
- [Forms and feedback](#forms-and-feedback)
- [Review](#review)

<!-- toc:end -->

## Required references

Follow the [Wikimedia Codex style guide](https://doc.wikimedia.org/codex/latest/style-guide/overview.html)
and [Using links and buttons](https://doc.wikimedia.org/codex/latest/style-guide/using-links-and-buttons.html).
These requirements apply to templates, DOM-created controls, page-tool launchers, and screenshots.

## Links and buttons

Use real links with meaningful destinations for navigation. Use native buttons or Codex Button
for operations such as opening a dialog, applying changes, copying, or dismissing content.
Set non-submit buttons to `type="button"`. Do not use `href="#"` as an action or
make a button look like an inline text link. Retain visible focus and accessible names;
icon-only buttons need an accessible label. Native buttons support Enter and Space.

## Action hierarchy and order

Use at most one primary progressive action per group. Secondary actions use normal weight,
tertiary actions quiet weight, and cancellation a neutral action. Destructive treatment is for
irreversible operations; separate those from forward actions. Place the primary action last
in horizontal reading and keyboard order (respecting RTL), first when stacked. Change DOM
order with layout so keyboard and visual order agree. Align dialog actions to the inline end.
Use `spacing-75` (12px) between separate actions; Codex ButtonGroup manages its own spacing.

## Forms and feedback

Give fields visible labels and contextual validation. Use inline Codex messages for actionable
errors, accessible progress for pending work, and native MediaWiki notifications for brief
feedback. Preserve form input after recoverable errors. Render article and translated content
as text; sanitize markup at its rendering boundary. Scope styles to tool-owned elements.

## Review

Check keyboard opening, focus, Enter, Space, Escape, focus restoration, narrow layouts,
LTR/RTL order, long translations, and light/dark themes when those states apply. Capture
actual controls with offline fixtures and inspect every documentation image after UI edits.
