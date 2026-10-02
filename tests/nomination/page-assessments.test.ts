/**
 * @file tests/nomination/page-assessments.test.ts
 * Purpose: tests / nomination / page assessments.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. fixture
 * 4. deferredAssessments
 * 5. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createDialogHost } from "../../src/features/nomination/dialog-host.ts";
import {
    NominationRuleSet,
    parseReasonTokens,
} from "../../src/domain/rules.ts";
import type { PageAssessment } from "../../src/domain/page-assessments.ts";
import type {
    DialogOperations,
    DialogServices,
} from "../../src/features/nomination/contracts.ts";
import { dialogRuntime, dialogServices, instantiateHost } from "./fixture.ts";

const operations: DialogOperations = {
    saveNewNomination: async () => false,
    saveModifiedNomination: async () => false,
    saveNominationCheck: async () => false,
    saveRawNominationSource: async () => false,
};

function fixture(lookup: NonNullable<DialogServices["getPageAssessments"]>) {
    const errors: Array<{ error: unknown; operation: string }> = [];
    const { ruleDict } = NominationRuleSet();
    const vm = instantiateHost(
        createDialogHost(dialogRuntime, operations, {
            ...dialogServices,
            getPageName: () => "Context article",
            getPageAssessments: lookup,
            reportError(error, operation) {
                errors.push({ error, operation });
            },
        }),
    );
    const nomination = (pageName: string, reason = "1c") => ({
        awarder: "Recipient",
        pageName,
        requestReasonText: reason,
        reasonParse: parseReasonTokens(reason, ruleDict),
    });
    const entry = (pageName: string, index = 0, reason = "1c") => ({
        nomination: nomination(pageName, reason),
        target: { type: "acg2", position: index + 1 },
        tableKey: "table-1",
        tableIndex: 0,
    });
    return { vm, errors, entry, nomination };
}

function deferredAssessments() {
    let resolve!: (assessments: PageAssessment[]) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<PageAssessment[]>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

test("assessment lookups cache completed and absent records by normalized page across checking navigation", async () => {
    const calls: string[] = [];
    const assessed = [{ project: "ACG", class: "乙" }];
    const { vm, entry } = fixture(async (pageName) => {
        calls.push(pageName);
        return pageName === "Other article" ? [] : assessed;
    });
    const closed = vm.openCheckBatch([
        entry(":example   article#Section"),
        entry("Other article", 1),
        entry("Example_article", 2),
    ]);
    await vm.refreshPageAssessments();
    assert.deepEqual(vm.pageAssessments, assessed);
    assert.equal(vm.assessmentLoading, false);
    vm.view = "reason-builder";
    await vm.refreshPageAssessments();
    assert.deepEqual(vm.assessmentGroups, []);
    vm.view = "main";
    await vm.refreshPageAssessments();
    assert.deepEqual(vm.pageAssessments, assessed);
    vm.activateCheckBatchItem(1);
    await vm.refreshPageAssessments();
    assert.deepEqual(vm.pageAssessments, []);
    vm.activateCheckBatchItem(2);
    await vm.refreshPageAssessments();
    assert.deepEqual(vm.pageAssessments, assessed);
    vm.activateCheckBatchItem(1);
    await vm.refreshPageAssessments();
    assert.deepEqual(vm.pageAssessments, []);
    assert.deepEqual(calls, ["Example article", "Other article"]);
    await vm.finishSession("cancel");
    assert.equal(await closed, "cancel");
    assert.equal(vm.assessmentRequests.size, 0);
    assert.deepEqual(vm.assessmentGroups, []);
});

test("assessment lookups share pending requests and cache offscreen results without replacing the active result", async () => {
    const first = deferredAssessments();
    const second = deferredAssessments();
    const calls: string[] = [];
    const { vm, entry } = fixture((pageName) => {
        calls.push(pageName);
        return pageName === "Other article" ? second.promise : first.promise;
    });
    const closed = vm.openCheckBatch([
        entry("Example_article"),
        entry("Other article", 1),
        entry("example article", 2),
    ]);
    const original = vm.refreshPageAssessments();
    vm.activateCheckBatchItem(1);
    const offscreen = vm.refreshPageAssessments();
    vm.activateCheckBatchItem(2);
    const active = vm.refreshPageAssessments();
    await Promise.resolve();
    assert.deepEqual(calls, ["Example article", "Other article"]);
    second.resolve([]);
    await offscreen;
    assert.deepEqual(vm.assessmentGroups, []);
    assert.equal(vm.assessmentLoading, true);
    const assessed = [{ project: "ACG", class: "甲" }];
    first.resolve(assessed);
    await Promise.all([original, active]);
    assert.deepEqual(vm.pageAssessments, assessed);
    assert.equal(vm.assessmentLoading, false);
    vm.activateCheckBatchItem(1);
    await vm.refreshPageAssessments();
    assert.deepEqual(vm.pageAssessments, []);
    assert.equal(calls.length, 2);
    await vm.finishSession("cancel");
    assert.equal(await closed, "cancel");
});

test("reopening starts a fresh assessment cache and ignores a pending reply from the previous opening", async () => {
    const oldLookup = deferredAssessments();
    const newLookup = deferredAssessments();
    let calls = 0;
    const { vm, entry } = fixture(() =>
        ++calls === 1 ? oldLookup.promise : newLookup.promise,
    );
    const firstClosed = vm.openCheckBatch([entry("Example article")]);
    const oldRequest = vm.refreshPageAssessments();
    await Promise.resolve();
    await vm.finishSession("cancel");
    assert.equal(await firstClosed, "cancel");
    assert.equal(vm.assessmentRequests.size, 0);
    const secondClosed = vm.openCheckBatch([entry("Example article")]);
    const newRequest = vm.refreshPageAssessments();
    await Promise.resolve();
    assert.equal(calls, 2);
    oldLookup.resolve([{ project: "ACG", class: "甲" }]);
    await oldRequest;
    assert.deepEqual(vm.assessmentGroups, []);
    assert.equal(vm.assessmentLoading, true);
    const current = [{ project: "ACG", class: "丙" }];
    newLookup.resolve(current);
    await newRequest;
    assert.deepEqual(vm.pageAssessments, current);
    assert.equal(vm.assessmentLoading, false);
    await vm.finishSession("cancel");
    assert.equal(await secondClosed, "cancel");
});

test("assessment failures are reported once, shared across callers, and retried without caching the failure", async () => {
    const pending = deferredAssessments();
    const failure = new Error("Assessment lookup unavailable");
    const assessed = [{ project: "ACG", class: "乙" }];
    let calls = 0;
    const { vm, entry, errors } = fixture(() =>
        ++calls === 1 ? pending.promise : Promise.resolve(assessed),
    );
    const closed = vm.openCheckBatch([entry("Example article")]);
    const first = vm.refreshPageAssessments();
    const repeated = vm.refreshPageAssessments();
    await Promise.resolve();
    assert.equal(calls, 1);
    pending.reject(failure);
    await Promise.all([first, repeated]);
    assert.equal(vm.assessmentError, true);
    assert.equal(vm.assessmentLoading, false);
    assert.equal(vm.assessmentRequests.size, 0);
    assert.deepEqual(errors, [
        { error: failure, operation: "lookup-page-assessments" },
    ]);
    await vm.refreshPageAssessments();
    assert.equal(calls, 2);
    assert.equal(vm.assessmentError, false);
    assert.deepEqual(vm.pageAssessments, assessed);
    await vm.refreshPageAssessments();
    assert.equal(calls, 2);
    await vm.finishSession("cancel");
    assert.equal(await closed, "cancel");
});

test("assessment targeting follows author drafts and avoids file, media, activity, and other categories", async () => {
    const calls: string[] = [];
    const { vm, entry } = fixture(async (pageName) => {
        calls.push(pageName);
        return [];
    });
    const authorClosed = vm.openNew();
    await vm.refreshPageAssessments();
    assert.deepEqual(calls, ["Context article"]);
    vm.activeNomination.pageName = "Edited article";
    await vm.refreshPageAssessments();
    assert.deepEqual(calls, ["Context article", "Edited article"]);
    for (const category of ["media", "activity", "recommendation"]) {
        vm.activeNomination.activeRuleCategory = category;
        await vm.refreshPageAssessments();
        assert.equal(vm.assessmentTarget, "");
        assert.deepEqual(vm.assessmentGroups, []);
    }
    vm.activeNomination.activeRuleCategory = "review";
    await vm.refreshPageAssessments();
    assert.equal(vm.assessmentTarget, "Edited article");
    assert.equal(calls.length, 2);
    await vm.finishSession("cancel");
    assert.equal(await authorClosed, "cancel");
    const checkingClosed = vm.openCheckBatch([
        entry("Image:Example.png"),
        entry("Example.png", 1, "6"),
        entry("Activity", 2, "7"),
        entry("Other nomination", 3, "8"),
    ]);
    for (let index = 0; index < 4; index++) {
        vm.activateCheckBatchItem(index);
        await vm.refreshPageAssessments();
        assert.equal(vm.assessmentTarget, "");
        assert.deepEqual(vm.assessmentGroups, []);
    }
    assert.equal(calls.length, 2);
    await vm.finishSession("cancel");
    assert.equal(await checkingClosed, "cancel");
});
