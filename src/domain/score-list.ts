/**
 * @file src/domain/score-list.ts
 * Purpose: Conservative source edits for the simple Lua table used by Module:ACGaward/list.
 *
 * Table of contents:
 * 1. ScoreDelta
 * 2. ScoreChange
 * 3. ScoreListUpdate
 * 4. decodeLuaName
 * 5. quoteLuaName
 * 6. applyScoreDeltas
 */

export interface ScoreDelta {
    userName: string;
    score: number;
}
interface ScoreChange extends ScoreDelta {
    previousScore: number;
    newScore: number;
}
export type ScoreListUpdate =
    | { ok: true; text: string; changes: ScoreChange[] }
    | { ok: false; error: { code: string } };

function decodeLuaName(quoted: string): string | null {
    const source = quoted.slice(1, -1);
    let result = "";
    const escapes: Record<string, string> = {
        a: "\x07",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\v",
    };
    for (let i = 0; i < source.length; i++) {
        const char = source[i];
        if (char !== "\\") {
            result += char;
            continue;
        }
        const next = source[++i];
        if (next === undefined) return null;
        if (next === "\\" || next === '"' || next === "'") result += next;
        else if (next in escapes) result += escapes[next];
        else if (/\d/u.test(next)) {
            const digits = source.slice(i).match(/^\d{1,3}/u)?.[0] ?? "";
            if (Number(digits) > 255) return null;
            result += String.fromCharCode(Number(digits));
            i += digits.length - 1;
        } else return null;
    }
    return result;
}

function quoteLuaName(name: string): string {
    return '"' + name.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"') + '"';
}

/** Retain comments, ordering and formatting, and refuse unsupported Lua rather than rewrite it. */
export function applyScoreDeltas(
    source: string,
    deltas: readonly ScoreDelta[],
): ScoreListUpdate {
    const combined = new Map<string, number>();
    for (const { userName, score } of deltas) {
        if (
            typeof userName !== "string" ||
            userName.trim() === "" ||
            Array.from(userName).some(
                (character) =>
                    character.charCodeAt(0) < 32 ||
                    character.charCodeAt(0) === 127,
            ) ||
            !Number.isFinite(score)
        )
            return { ok: false, error: { code: "invalid-score-delta" } };
        const name = userName.trim();
        const delta = Number(
            ((combined.get(name) ?? 0) + score).toPrecision(15),
        );
        if (!Number.isFinite(delta))
            return { ok: false, error: { code: "invalid-score-delta" } };
        combined.set(name, delta);
    }
    for (const [name, score] of combined)
        if (score === 0) combined.delete(name);
    if (combined.size === 0) return { ok: true, text: source, changes: [] };
    const wrapper =
        /^(\s*return\s*\{)([\s\S]*)(\}\s*(?:--[^\r\n]*)?\s*)$/u.exec(source);
    if (!wrapper)
        return { ok: false, error: { code: "unsupported-score-list" } };
    const body = wrapper[2];
    const lines = body.split(/(?<=\n)/u);
    const entries = new Map<
        string,
        { line: number; prefix: string; suffix: string; score: number }
    >();
    const pattern =
        /^(\s*\[\s*)((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))(\s*\]\s*=\s*)([+-]?(?:\d+(?:\.\d*)?|\.\d+))([\t ]*,?[\t ]*(?:--[^\r\n]*)?\r?\n?)$/u;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (/^\s*(?:--[^\r\n]*)?\r?\n?$/u.test(line)) {
            // Long-bracket comments need a Lua parser; never mistake their contents for entries.
            if (/^\s*--\[=*\[/u.test(line))
                return { ok: false, error: { code: "unsupported-score-list" } };
            continue;
        }
        const match = pattern.exec(line);
        if (!match)
            return { ok: false, error: { code: "unsupported-score-list" } };
        const name = decodeLuaName(match[2]);
        const score = Number(match[4]);
        if (name === null || !Number.isFinite(score) || entries.has(name)) {
            return { ok: false, error: { code: "invalid-score-list-entry" } };
        }
        entries.set(name, {
            line: index,
            prefix: match[1] + match[2] + match[3],
            suffix: match[5],
            score,
        });
    }
    const changes: ScoreChange[] = [];
    const additions: string[] = [];
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    for (const [userName, score] of combined) {
        const entry = entries.get(userName);
        const previousScore = entry?.score ?? 0;
        const newScore = Number((previousScore + score).toPrecision(15));
        if (!Number.isFinite(newScore) || newScore < 0)
            return { ok: false, error: { code: "invalid-resulting-score" } };
        changes.push({ userName, score, previousScore, newScore });
        if (entry) lines[entry.line] = entry.prefix + newScore + entry.suffix;
        else
            additions.push(
                `    [${quoteLuaName(userName)}] = ${newScore},${newline}`,
            );
    }
    if (additions.length > 0) {
        const lastEntry = [...entries.values()].at(-1);
        if (lastEntry && !/^\s*,/u.test(lastEntry.suffix)) {
            // A Lua final entry may omit its comma. Add it before appending a new entry.
            const currentLine = lines[lastEntry.line];
            const suffixLength = lastEntry.suffix.length;
            lines[lastEntry.line] =
                currentLine.slice(0, currentLine.length - suffixLength) +
                "," +
                lastEntry.suffix;
        }
    }
    let nextBody = lines.join("");
    if (additions.length > 0) {
        const trailing = nextBody.match(/[\t ]*$/u)?.[0] ?? "";
        nextBody = nextBody.slice(0, nextBody.length - trailing.length);
        if (!nextBody.endsWith("\n")) nextBody += newline;
        nextBody += additions.join("") + trailing;
    }
    return { ok: true, text: wrapper[1] + nextBody + wrapper[3], changes };
}
