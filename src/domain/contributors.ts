/**
 * @file src/domain/contributors.ts
 * Purpose: src / domain / contributors module.
 *
 * Table of contents:
 * 1. ContributionRevision
 * 2. largestContributor
 */

export interface ContributionRevision {
    revid: number;
    parentid: number;
    timestamp: string;
    size: number;
    user?: string;
    userhidden?: unknown;
}

/** Rank visible editors by bytes added, without charging them for deletions. */
export function largestContributor(
    revisions: readonly ContributionRevision[],
    parentSizes: ReadonlyMap<number, number>,
    since: Date,
    until: Date,
): string | null {
    const sizes = new Map(parentSizes);
    const unique = new Map(
        revisions.map((revision) => [revision.revid, revision]),
    );
    for (const revision of unique.values())
        sizes.set(revision.revid, revision.size);
    const totals = new Map<string, number>();
    for (const revision of unique.values()) {
        const timestamp =
            typeof revision.timestamp === "string"
                ? Date.parse(revision.timestamp)
                : NaN;
        if (!Number.isFinite(timestamp))
            throw new Error("Revision timestamp is unavailable");
        if (timestamp < since.getTime() || timestamp > until.getTime())
            continue;
        const parentSize =
            revision.parentid === 0 ? 0 : sizes.get(revision.parentid);
        if (
            !Number.isSafeInteger(revision.size) ||
            revision.size < 0 ||
            parentSize === undefined ||
            !Number.isSafeInteger(parentSize) ||
            parentSize < 0
        )
            throw new Error("Revision size or parent size is unavailable");
        if (
            Object.prototype.hasOwnProperty.call(revision, "userhidden") ||
            typeof revision.user !== "string" ||
            !revision.user.trim()
        )
            continue;
        const added = Math.max(0, revision.size - parentSize);
        totals.set(revision.user, (totals.get(revision.user) ?? 0) + added);
    }
    let recipient: string | null = null;
    let mostBytes = 0;
    for (const [user, total] of totals) {
        if (
            total > mostBytes ||
            (total === mostBytes &&
                total > 0 &&
                recipient !== null &&
                user < recipient)
        ) {
            recipient = user;
            mostBytes = total;
        }
    }
    return recipient;
}
