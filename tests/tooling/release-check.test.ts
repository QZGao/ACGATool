import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
    copyFile,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function releaseFixture(version = "2.0.0-alpha") {
    const root = await mkdtemp(join(tmpdir(), "acga-release-test-"));
    await mkdir(join(root, "scripts"));
    await mkdir(join(root, "dist"));
    await copyFile(
        new URL("../../scripts/release-check.ts", import.meta.url),
        join(root, "scripts/release-check.ts"),
    );
    await writeFile(
        join(root, "package.json"),
        JSON.stringify({ type: "module", version }),
    );
    await writeFile(
        join(root, "package-lock.json"),
        JSON.stringify({ version, packages: { "": { version } } }),
    );
    await writeFile(
        join(root, "CHANGELOG.md"),
        `# Changelog\n\n## [${version}] - 2026-09-27\n\nReviewed release notes.\n`,
    );
    const git = (...args: string[]) =>
        execFileSync("git", args, {
            cwd: root,
            encoding: "utf8",
            stdio: "pipe",
        });
    git("init", "--quiet", "--initial-branch=main");
    git("add", ".");
    const commit = () =>
        git(
            "-c",
            "user.name=Offline fixture",
            "-c",
            "user.email=fixture@example.test",
            "commit",
            "--quiet",
            "--allow-empty",
            "-m",
            "Fixture",
        );
    commit();
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("tag", `v${version}`);
    return {
        root,
        git,
        commit,
        run: (tag = `v${version}`) =>
            spawnSync(process.execPath, ["scripts/release-check.ts", tag], {
                cwd: root,
                encoding: "utf8",
                env: {
                    ...process.env,
                    GITHUB_OUTPUT: join(root, "github-output"),
                },
            }),
        dispose: () => rm(root, { recursive: true, force: true }),
    };
}

test("release checker accepts a matching main-branch prerelease and exports reviewed notes", async () => {
    const fixture = await releaseFixture();
    try {
        const result = fixture.run();
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
            await readFile(join(fixture.root, "dist/release-notes.md"), "utf8"),
            "Reviewed release notes.\n",
        );
        assert.equal(
            await readFile(join(fixture.root, "github-output"), "utf8"),
            "prerelease=true\n",
        );
    } finally {
        await fixture.dispose();
    }
});

test("release checker rejects mismatched tags and lockfile versions", async () => {
    const fixture = await releaseFixture("2.0.0");
    try {
        const wrongTag = fixture.run("v2.0.1");
        assert.notEqual(wrongTag.status, 0);
        assert.match(wrongTag.stderr, /must match package version/u);
        await writeFile(
            join(fixture.root, "package-lock.json"),
            JSON.stringify({
                version: "1.0.0",
                packages: { "": { version: "2.0.0" } },
            }),
        );
        const wrongLock = fixture.run();
        assert.notEqual(wrongLock.status, 0);
        assert.match(
            wrongLock.stderr,
            /package-lock.json versions must match/u,
        );
    } finally {
        await fixture.dispose();
    }
});

test("release checker rejects a correctly named tag outside main ancestry", async () => {
    const fixture = await releaseFixture("2.0.0");
    try {
        fixture.git("checkout", "--quiet", "-b", "unreviewed");
        fixture.commit();
        fixture.git("tag", "--force", "v2.0.0");
        const result = fixture.run();
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /merge-base --is-ancestor/u);
    } finally {
        await fixture.dispose();
    }
});
