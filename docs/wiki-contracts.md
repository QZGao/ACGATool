# Chinese Wikipedia integration

The implementation was checked against the public template source and rendered
registration-page markup on 2026-09-27. These are integration contracts rather
than a dependency on either reference repository.

- [Template:ACG提名2](https://zh.wikipedia.org/wiki/Template:ACG提名2)
  accepts numbered article, recipient, request, and check fields for 25 items.
  Larger submissions are split into multiple templates within one page edit.
- [Template:ACG提名2/item](https://zh.wikipedia.org/wiki/Template:ACG提名2/item)
  renders each item as two rows. The article cell has a row scope and spans both
  rows; the check appears in `.mw-notalk` in the second row. Integration only
  reads rows belonging to the nomination table itself, excluding nested tables.
- The [registration page](https://zh.wikipedia.org/wiki/WikiProject:ACG/維基ACG專題獎/登記處)
  groups nominations beneath level-three month/day headings. Repeated date
  headings remain distinct. Source parsing masks comments and literal extension
  tags so invisible examples cannot shift the rendered nomination index.
- Legacy `ACG提名` and nested extra nominations remain readable. Unknown reason
  syntax stays available for deliberate source editing or repair. A batch
  resolves every target against one source snapshot and rejects overlapping or
  changed targets before writing.
- [Template:ACG提名2/check](https://zh.wikipedia.org/wiki/Template:ACG提名2/check)
  also permits statuses that do not represent a straightforward new score.
  Automatic score adjustments require a recognized previous check; otherwise
  the tool preserves the edit and requests manual reconciliation.

The interface follows the [Codex form guidance](https://doc.wikimedia.org/codex/latest/style-guide/constructing-forms.html):
visible labels, related fields grouped together, validation on submission, and
stacked fields on narrow screens. Rule 5 exposes the review tier and default score
first, with specialist aspects and custom scores available when needed.

Tests use synthetic local fixtures. No automated test reads or edits the live wiki.
