/** The nomination target and recipient lookup derived from the viewed page. */
export interface NominationPageContext {
    pageName: string;
    initialCategory: "article" | "media";
    recipientScope: "article" | "media" | "revision";
    revisionId?: number;
}

interface PageConfiguration {
    pageName: string;
    title: string;
    namespaceNumber: number;
    revisionId: unknown;
    currentRevisionId: unknown;
    diffNewId: unknown;
}

function revisionNumber(value: unknown): number | undefined {
    if (typeof value !== "number" && typeof value !== "string") return;
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

/** MediaViewer keeps the host page's config, so its file must come from the URL. */
export function nominationPageContext(
    configuration: PageConfiguration,
    location: Pick<Location, "hash" | "search">,
): NominationPageContext {
    let mediaTitle = "";
    try {
        const hash = decodeURIComponent(location.hash);
        mediaTitle = /^#\/media\/(File:.+)$/iu.exec(hash)?.[1] ?? "";
    } catch {
        // A malformed URL fragment is not a nomination target.
    }
    if (mediaTitle)
        return {
            pageName: mediaTitle.replaceAll("_", " "),
            initialCategory: "media",
            recipientScope: "media",
        };
    const filePage = configuration.namespaceNumber === 6;
    const pageName = filePage
        ? configuration.pageName.replaceAll("_", " ")
        : [0, 1].includes(configuration.namespaceNumber)
          ? configuration.title
          : "";
    const query = new URLSearchParams(location.search);
    const diffNewId = revisionNumber(configuration.diffNewId);
    const revisionId = diffNewId ?? revisionNumber(configuration.revisionId);
    const currentRevisionId = revisionNumber(configuration.currentRevisionId);
    const fixedRevision = Boolean(
        diffNewId ||
        query.has("oldid") ||
        query.has("diff") ||
        (revisionId && currentRevisionId && revisionId !== currentRevisionId),
    );
    return {
        pageName,
        initialCategory: filePage ? "media" : "article",
        recipientScope:
            fixedRevision && revisionId
                ? "revision"
                : filePage
                  ? "media"
                  : "article",
        ...(fixedRevision && revisionId ? { revisionId } : {}),
    };
}
