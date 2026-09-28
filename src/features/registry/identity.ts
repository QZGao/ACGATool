/** DiscussionTools fragments are accepted only as plain safe link fragments. */
export function normalizeDiscussionCommentId(
    value: unknown,
): string | undefined {
    const id = typeof value === "string" ? value.trim() : "";
    return /^c-[^\s#[\]{}|<>]+$/u.test(id) ? id : undefined;
}

export function findPrecedingDiscussionCommentId(
    table: Element,
): string | undefined {
    let sibling = table.previousElementSibling;
    while (sibling) {
        if (sibling.matches(".mw-heading, h2, h3, table.acgnom-table")) return;
        const markers = sibling.matches("span[data-mw-comment-start][id]")
            ? [sibling]
            : Array.from(
                  sibling.querySelectorAll("span[data-mw-comment-start][id]"),
              );
        for (const marker of markers.reverse()) {
            const id = normalizeDiscussionCommentId(marker.id);
            if (id) return id;
        }
        sibling = sibling.previousElementSibling;
    }
}
