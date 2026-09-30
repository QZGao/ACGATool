export interface PageAssessment {
    project: string;
    class: string;
}

interface PageAssessmentProject {
    name: string;
    emphasized: boolean;
}

export interface PageAssessmentGroup {
    className: string;
    projects: PageAssessmentProject[];
}

interface AssessmentClass {
    key: string;
    rank: number;
    label: string;
    chinese: boolean;
}

const CLASS_ALIASES = new Map<string, AssessmentClass>();
const CLASSES: Array<{
    label: string;
    rank: number;
    chinese: string[];
    english: string[];
}> = [
    {
        label: "典范",
        rank: 0,
        chinese: ["典范", "典範", "特色"],
        english: ["FA"],
    },
    {
        label: "特色列表",
        rank: 0,
        chinese: ["特色列表"],
        english: ["FL"],
    },
    {
        label: "甲",
        rank: 1,
        chinese: ["甲", "甲级", "甲級"],
        english: ["A"],
    },
    {
        label: "甲级列表",
        rank: 1,
        chinese: ["甲级列表", "甲級列表"],
        english: ["AL", "A-LIST"],
    },
    {
        label: "优良",
        rank: 2,
        chinese: ["优良", "優良"],
        english: ["GA"],
    },
    {
        label: "乙上",
        rank: 3,
        chinese: ["乙上"],
        english: ["B+"],
    },
    {
        label: "乙",
        rank: 4,
        chinese: ["乙", "乙级", "乙級"],
        english: ["B"],
    },
    {
        label: "乙级列表",
        rank: 4,
        chinese: ["乙级列表", "乙級列表"],
        english: ["BL", "B-LIST"],
    },
    {
        label: "丙",
        rank: 5,
        chinese: ["丙", "丙级", "丙級"],
        english: ["C"],
    },
    {
        label: "丙级列表",
        rank: 5,
        chinese: ["丙级列表", "丙級列表"],
        english: ["CL", "C-LIST"],
    },
    {
        label: "丁",
        rank: 6,
        chinese: ["丁", "丁级", "丁級"],
        english: ["D"],
    },
    {
        label: "初",
        rank: 7,
        chinese: ["初"],
        english: ["START"],
    },
    {
        label: "列表",
        rank: 7,
        chinese: ["列表"],
        english: ["LIST"],
    },
    {
        label: "小作品",
        rank: 8,
        chinese: ["小作品"],
        english: ["STUB"],
    },
    {
        label: "小列表",
        rank: 8,
        chinese: ["小列表"],
        english: ["STUBLIST", "STUB LIST", "STUB-LIST"],
    },
    {
        label: "小小作品",
        rank: 9,
        chinese: ["小小作品"],
        english: ["SUBSTUB", "SUB-STUB"],
    },
];

for (const assessment of CLASSES) {
    for (const label of assessment.chinese)
        CLASS_ALIASES.set(label, {
            key: assessment.label,
            rank: assessment.rank,
            label,
            chinese: true,
        });
    for (const alias of assessment.english)
        CLASS_ALIASES.set(alias, {
            key: assessment.label,
            rank: assessment.rank,
            label: assessment.label,
            chinese: false,
        });
}

function assessmentClass(value: string): AssessmentClass {
    return (
        CLASS_ALIASES.get(value) ??
        CLASS_ALIASES.get(value.toUpperCase().replace(/-CLASS$/u, "")) ?? {
            key: value,
            rank: Infinity,
            label: value,
            chinese: false,
        }
    );
}

function projectPriority(name: string): number {
    if (name.toUpperCase() === "ACG") return 0;
    if (name === "动画" || name === "動畫") return 1;
    if (name === "漫画" || name === "漫畫") return 2;
    if (name === "电子游戏" || name === "電子遊戲") return 3;
    return 4;
}

/** Group assessment text for safe interpolation, in descending quality order. */
export function groupPageAssessments(
    assessments: readonly PageAssessment[],
): PageAssessmentGroup[] {
    const groups = new Map<
        string,
        {
            assessment: AssessmentClass;
            projects: Map<string, PageAssessmentProject>;
        }
    >();
    for (const entry of assessments) {
        const project = entry.project.trim();
        const className = entry.class.trim();
        if (!project || !className || /[/／]/u.test(project)) continue;
        const assessment = assessmentClass(className);
        let group = groups.get(assessment.key);
        if (!group) {
            group = { assessment, projects: new Map() };
            groups.set(assessment.key, group);
        } else if (assessment.chinese && !group.assessment.chinese) {
            // Prefer the wiki's Chinese spelling over an English alias label.
            group.assessment = assessment;
        }
        group.projects.set(project, {
            name: project,
            emphasized: projectPriority(project) < 4,
        });
    }
    return [...groups.values()]
        .sort((left, right) => left.assessment.rank - right.assessment.rank)
        .map(({ assessment, projects }) => ({
            className: assessment.label,
            projects: [...projects.values()].sort(
                (left, right) =>
                    projectPriority(left.name) - projectPriority(right.name),
            ),
        }));
}
