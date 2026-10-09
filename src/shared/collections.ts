/** Map a list and flatten one level, preserving order and skipping sparse holes. */
export function flatMap<T, U>(
    values: readonly T[],
    callback: (
        value: T,
        index: number,
        array: readonly T[],
    ) => U | readonly U[],
): U[] {
    const result: U[] = [];
    values.forEach((value, index) => {
        const mapped = callback(value, index, values);
        if (Array.isArray(mapped))
            mapped.forEach((item: U) => result.push(item));
        else result.push(mapped as U);
    });
    return result;
}

/** Define own data properties so untrusted keys cannot change the record prototype. */
export function fromEntries<T>(
    entries: Iterable<readonly [PropertyKey, T]>,
): Record<string, T> {
    const result: Record<string, T> = {};
    for (const [key, value] of entries) {
        Object.defineProperty(result, key, {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
        });
    }
    return result;
}
