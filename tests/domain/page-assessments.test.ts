import assert from "node:assert/strict";
import test from "node:test";
import { groupPageAssessments } from "../../src/domain/page-assessments.ts";
import type { PageAssessment } from "../../src/domain/page-assessments.ts";

test("higher quality groups come first with ACG projects emphasized first", () => {
    assert.deepEqual(
        groupPageAssessments([
            { project: "通用评级", class: "丙" },
            { project: "电子游戏", class: "丙" },
            { project: "ACG", class: "丙" },
            { project: "虚构专题", class: "乙" },
            { project: "漫画", class: "丙" },
            { project: "動畫", class: "丙" },
            { project: "其他专题", class: "丙" },
        ]),
        [
            {
                className: "乙",
                projects: [{ name: "虚构专题", emphasized: false }],
            },
            {
                className: "丙",
                projects: [
                    { name: "ACG", emphasized: true },
                    { name: "動畫", emphasized: true },
                    { name: "漫画", emphasized: true },
                    { name: "电子游戏", emphasized: true },
                    { name: "通用评级", emphasized: false },
                    { name: "其他专题", emphasized: false },
                ],
            },
        ],
    );
});

test("all documented article qualities sort before unknown classes", () => {
    const classes = [
        "典範",
        "甲",
        "優良",
        "乙上",
        "乙",
        "丙",
        "丁",
        "初",
        "小作品",
        "小小作品",
    ];
    assert.deepEqual(
        groupPageAssessments([
            { project: "Project", class: "未评" },
            ...classes.toReversed().map((className) => ({
                project: "Project",
                class: className,
            })),
            { project: "Project", class: "消歧义" },
        ]).map((group) => group.className),
        [...classes, "未评", "消歧义"],
    );
});

test("list assessments retain separate groups at their corresponding quality", () => {
    const classes = [
        "小列表",
        "小作品",
        "列表",
        "初",
        "丙级列表",
        "丙",
        "乙級列表",
        "乙",
        "甲级列表",
        "甲",
        "特色列表",
        "典范",
    ];
    assert.deepEqual(
        groupPageAssessments(
            classes.map((className) => ({
                project: "Project",
                class: className,
            })),
        ).map((group) => group.className),
        [
            "特色列表",
            "典范",
            "甲级列表",
            "甲",
            "乙級列表",
            "乙",
            "丙级列表",
            "丙",
            "列表",
            "初",
            "小列表",
            "小作品",
        ],
    );
});

test("Chinese variants and English aliases group together and preserve wiki labels", () => {
    assert.deepEqual(
        groupPageAssessments([
            { project: "General", class: "ga" },
            { project: "動畫", class: "優良" },
            { project: "漫画", class: "优良" },
            { project: "Featured", class: "FA-Class" },
            { project: "ACG", class: "特色" },
            { project: "Game", class: "典範" },
            { project: "List", class: "FL" },
            { project: "List2", class: "甲級列表" },
            { project: "List3", class: "AL" },
        ]),
        [
            {
                className: "特色",
                projects: [
                    { name: "ACG", emphasized: true },
                    { name: "Featured", emphasized: false },
                    { name: "Game", emphasized: false },
                ],
            },
            {
                className: "特色列表",
                projects: [{ name: "List", emphasized: false }],
            },
            {
                className: "甲級列表",
                projects: [
                    { name: "List2", emphasized: false },
                    { name: "List3", emphasized: false },
                ],
            },
            {
                className: "優良",
                projects: [
                    { name: "動畫", emphasized: true },
                    { name: "漫画", emphasized: true },
                    { name: "General", emphasized: false },
                ],
            },
        ],
    );
});

test("taskforces and blank entries are excluded and repeated projects stay unique", () => {
    assert.deepEqual(
        groupPageAssessments([
            { project: "电子游戏/角色", class: "甲" },
            { project: "電子遊戲／角色", class: "甲" },
            { project: "ACG", class: "丙" },
            { project: " ACG ", class: " C-Class " },
            { project: "Empty", class: " " },
            { project: " ", class: "乙" },
        ]),
        [
            {
                className: "丙",
                projects: [{ name: "ACG", emphasized: true }],
            },
        ],
    );
    assert.deepEqual(groupPageAssessments([]), []);
});

test("untrusted names remain text and grouping leaves the input untouched", () => {
    const entries: PageAssessment[] = [
        { project: "<img src=x onerror=alert(1)>", class: "乙" },
        { project: "__proto__", class: "<script>alert(1)" },
        { project: "constructor", class: "__proto__" },
    ];
    const before = structuredClone(entries);
    assert.deepEqual(groupPageAssessments(entries), [
        {
            className: "乙",
            projects: [
                {
                    name: "<img src=x onerror=alert(1)>",
                    emphasized: false,
                },
            ],
        },
        {
            className: "<script>alert(1)",
            projects: [{ name: "__proto__", emphasized: false }],
        },
        {
            className: "__proto__",
            projects: [{ name: "constructor", emphasized: false }],
        },
    ]);
    assert.deepEqual(entries, before);
});
