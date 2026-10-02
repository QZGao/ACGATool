/**
 * @file tests/nomination/fixture.ts
 * Purpose: tests / nomination / fixture module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. instantiateHost
 */

import { createTranslator } from "../../src/i18n/index.ts";
import { reactive } from "vue";
import type { ComponentOptions } from "vue";
import type {
    DialogRuntime,
    DialogServices,
} from "../../src/features/nomination/contracts.ts";

export const dialogServices: DialogServices = {
    msg: createTranslator("zh-Hant").msg,
    getUserName: () => "Example",
    getUrl: (title) => "/wiki/" + encodeURIComponent(title),
    addStyles: () => () => {},
    notify() {
        throw new Error("Unexpected notification");
    },
    reportError(error) {
        throw error;
    },
    document: { querySelector: () => null } as unknown as Document,
};
export const dialogRuntime = { Vue: {}, Codex: {} } as DialogRuntime;

/** Exercises the real Options API controller through Vue's reactive drafts. */
export function instantiateHost(
    component: ComponentOptions,
    context: Record<string, any> = {},
): any {
    const host = component as any;
    const vm: any = reactive({ ...context, ...host.data?.call(context) });
    for (const [name, method] of Object.entries<any>(host.methods)) {
        vm[name] = method.bind(vm);
    }
    for (const [name, definition] of Object.entries<any>(host.computed)) {
        const getter =
            typeof definition === "function" ? definition : definition.get;
        Object.defineProperty(vm, name, {
            get: getter.bind(vm),
            ...(definition.set ? { set: definition.set.bind(vm) } : {}),
        });
    }
    vm.$nextTick = () => Promise.resolve();
    return vm;
}
