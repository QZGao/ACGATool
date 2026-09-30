import type { PageAssessment } from "../../domain/page-assessments.ts";
import type { ApiClient } from "./api.ts";

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("MediaWiki returned unreadable page assessments");
    return value as Record<string, unknown>;
}

function queryPage(response: Record<string, unknown>): Record<string, unknown> {
    if (response.error || response.warnings)
        throw new Error("MediaWiki could not retrieve page assessments");
    const query = record(response.query);
    const pages = Array.isArray(query.pages)
        ? query.pages
        : Object.values(record(query.pages));
    if (pages.length !== 1)
        throw new Error("MediaWiki returned ambiguous page assessments");
    return record(pages[0]);
}

/** Read every project assessment without requesting subprojects or task forces. */
export async function getPageAssessments(
    client: ApiClient,
    pageName: string,
): Promise<PageAssessment[]> {
    const title = pageName.trim().replaceAll("_", " ");
    if (!title) return [];
    const parameters = {
        action: "query",
        formatversion: 2,
        titles: title,
        redirects: true,
        prop: "pageassessments",
        palimit: "max",
    };
    const assessments = new Map<string, PageAssessment>();
    let continuation: Record<string, string> = {};
    const seenContinuations = new Set<string>();
    for (;;) {
        const response = record(
            await client.get({ ...parameters, ...continuation }),
        );
        const page = queryPage(response);
        if (Object.prototype.hasOwnProperty.call(page, "invalid"))
            throw new Error("MediaWiki returned an invalid assessment title");
        if (Object.prototype.hasOwnProperty.call(page, "missing")) return [];
        if (page.pageassessments !== undefined) {
            for (const [name, value] of Object.entries(
                record(page.pageassessments),
            )) {
                const project = name.trim();
                if (!project || project.includes("/")) continue;
                const assessment = record(value);
                if (
                    typeof assessment.class !== "string" ||
                    !assessment.class.trim()
                )
                    continue;
                assessments.set(project, {
                    project,
                    class: assessment.class.trim(),
                });
            }
        }
        if (response.continue === undefined) break;
        const nextContinuation = record(response.continue);
        const next = nextContinuation.pacontinue;
        if (typeof next !== "string" || !next || seenContinuations.has(next))
            throw new Error(
                "MediaWiki assessment continuation did not advance",
            );
        seenContinuations.add(next);
        continuation = { pacontinue: next };
        if (typeof nextContinuation.continue === "string")
            continuation.continue = nextContinuation.continue;
    }
    return [...assessments.values()];
}
