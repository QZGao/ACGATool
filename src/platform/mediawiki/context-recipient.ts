import type { ApiClient } from "./api.ts";

function queryPages(value: unknown): Record<string, unknown>[] {
    if (!value || typeof value !== "object" || "error" in value)
        throw new Error("MediaWiki returned no readable recipient metadata");
    const query = (value as { query?: { pages?: unknown } }).query;
    if (!query || !Array.isArray(query.pages))
        throw new Error("MediaWiki returned no readable recipient metadata");
    return query.pages.map((page: unknown) => {
        if (!page || typeof page !== "object" || Array.isArray(page))
            throw new Error("MediaWiki returned invalid recipient metadata");
        return page as Record<string, unknown>;
    });
}

function visibleUser(value: unknown): string | null {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("MediaWiki returned invalid user metadata");
    const metadata = value as Record<string, unknown>;
    if ("userhidden" in metadata) return null;
    if (typeof metadata.user !== "string" || !metadata.user.trim())
        throw new Error("MediaWiki returned no readable user name");
    return metadata.user.trim();
}

/** Shared Commons files can be marked missing locally while retaining imageinfo. */
export async function getLatestFileUploader(
    api: ApiClient,
    pageName: string,
): Promise<string | null> {
    if (!pageName.trim()) return null;
    const pages = queryPages(
        await api.get({
            action: "query",
            formatversion: 2,
            titles: pageName,
            prop: "imageinfo",
            iiprop: "user",
            iilimit: 1,
        }),
    );
    if (pages.length !== 1)
        throw new Error("MediaWiki returned ambiguous file metadata");
    const page = pages[0]!;
    if ("invalid" in page)
        throw new Error("MediaWiki returned an invalid file title");
    if (page.imageinfo === undefined) {
        if ("missing" in page || page.imagerepository === "") return null;
        throw new Error("MediaWiki returned no upload metadata");
    }
    if (!Array.isArray(page.imageinfo))
        throw new Error("MediaWiki returned invalid upload metadata");
    return page.imageinfo.length ? visibleUser(page.imageinfo[0]) : null;
}

/** Look up the exact viewed revision, including the new side of diff-only views. */
export async function getRevisionEditor(
    api: ApiClient,
    revisionId: number,
): Promise<string | null> {
    if (!Number.isSafeInteger(revisionId) || revisionId < 1) return null;
    const pages = queryPages(
        await api.get({
            action: "query",
            formatversion: 2,
            revids: revisionId,
            prop: "revisions",
            rvprop: "ids|user",
        }),
    );
    const revisions = pages.flatMap((page) => {
        if (page.revisions === undefined) return [];
        if (!Array.isArray(page.revisions))
            throw new Error("MediaWiki returned invalid revision metadata");
        return page.revisions;
    });
    const revision = revisions.find(
        (item: unknown) =>
            item &&
            typeof item === "object" &&
            (item as Record<string, unknown>).revid === revisionId,
    );
    if (!revision) return null;
    return visibleUser(revision);
}
