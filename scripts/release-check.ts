/** Verify the release version, repository ancestry, and reviewed notes. */
import { execFileSync } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(
    await readFile(new URL("package.json", root), "utf8"),
) as { version: string };
const lock = JSON.parse(
    await readFile(new URL("package-lock.json", root), "utf8"),
) as {
    version: string;
    packages: Record<string, { version?: string }>;
};
const tag = process.argv[2];
const version = manifest.version;
const semver =
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
if (!semver.test(version) || tag !== `v${version}`) {
    throw new Error(
        `Release tag ${tag} must match package version v${version}.`,
    );
}
if (lock.version !== version || lock.packages[""]?.version !== version) {
    throw new Error("package-lock.json versions must match package.json.");
}
const git = (args: string[]): string =>
    execFileSync("git", args, {
        cwd: fileURLToPath(root),
        encoding: "utf8",
    }).trim();
const taggedCommit = git([
    "rev-parse",
    "--verify",
    `refs/tags/${tag}^{commit}`,
]);
git(["merge-base", "--is-ancestor", taggedCommit, "refs/remotes/origin/main"]);

const changelog = await readFile(new URL("CHANGELOG.md", root), "utf8");
const section = changelog
    .split(/^## /mu)
    .slice(1)
    .find((entry) => {
        const heading = entry.split("\n", 1)[0];
        return (
            heading === `[${version}]` || heading?.startsWith(`[${version}] - `)
        );
    });
const notes = section?.split("\n").slice(1).join("\n").trim();
if (!notes) throw new Error(`CHANGELOG.md needs release notes for ${version}.`);
await writeFile(new URL("dist/release-notes.md", root), `${notes}\n`);
const prerelease = version.split("+", 1)[0]!.includes("-");
if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `prerelease=${prerelease}\n`);
console.log(`Verified ${tag} on origin/main (prerelease=${prerelease}).`);
