/** Run Playwright with temporary reports, preserving its exit status. */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { constants, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = await mkdtemp(join(tmpdir(), "acga-tool-tests-"));
let cleanup = (): void => undefined;

try {
    const child = spawn(
        process.execPath,
        [
            fileURLToPath(import.meta.resolve("@playwright/test/cli")),
            "test",
            ...process.argv.slice(2),
            "--output",
            output,
            "--last-failed-file",
            join(output, "last-run.json"),
        ],
        {
            cwd: root,
            stdio: "inherit",
            env: {
                ...process.env,
                PLAYWRIGHT_HTML_OUTPUT_DIR: join(output, "html"),
                PLAYWRIGHT_HTML_OPEN: "never",
                PLAYWRIGHT_BLOB_OUTPUT_DIR: join(output, "blob"),
                PLAYWRIGHT_JSON_OUTPUT_FILE: join(output, "results.json"),
                PLAYWRIGHT_JUNIT_OUTPUT_FILE: join(output, "results.xml"),
            },
        },
    );
    let interruptedBy: "SIGINT" | "SIGTERM" | undefined;
    const interrupt = (signal: "SIGINT" | "SIGTERM"): void => {
        interruptedBy ??= signal;
        child.kill("SIGINT");
    };
    const onInterrupt = (): void => interrupt("SIGINT");
    const onTerminate = (): void => interrupt("SIGTERM");
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onTerminate);
    cleanup = () => {
        process.off("SIGINT", onInterrupt);
        process.off("SIGTERM", onTerminate);
    };
    const result = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
    }>((resolveExit, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolveExit({ code, signal }));
    });
    process.exitCode =
        interruptedBy == null
            ? (result.code ??
              128 +
                  (result.signal == null
                      ? 1
                      : constants.signals[result.signal]))
            : 128 + constants.signals[interruptedBy];
} finally {
    try {
        await rm(output, { recursive: true, force: true });
    } finally {
        cleanup();
    }
}
