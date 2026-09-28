/** Canonical on-wiki rule descriptions; UI catalogs provide translated display labels. */
const CANONICAL_RULE_MESSAGES = {
    content_expansion: "內容擴充",
    add_or_expand_article_content_new_content_of_at_least:
        "鼓勵編者新增或擴充條目內容。新內容達 2 kB 為「短擴充」，達 3 kB 為「中擴充」，達 5 kB 為「長擴充」。",
    short_expansion: "短新增",
    medium_expansion: "中新增",
    long_expansion: "長新增",
    quality_improvement: "品質提升",
    choose_the_article_s_quality_class_before_and_after_improvement:
        "以條目品質評級為標準，提升條目品質。選擇完善前與完善後品質",
    c_class: "丙級",
    b_class: "乙級",
    good_article: "優良",
    featured_article: "典特",
    formatting: "格式",
    recognizes_well_formatted_articles_editors_below_creation_award_level_5:
        "鼓勵編者創作整潔的條目。對於未滿 5 級創作獎的編者，條目應採用 ref 格式搭配 Cite 家族模板列出來源，引文沒有格式錯誤；對於已滿 5 級創作獎的有經驗編者，條目須行文通順、符合命名常規、遵循格式手冊。此項得分需依附於項目 1 或 2，不可單獨申請。",
    "4_activities": "(4) 活動",
    activity: "活動",
    request: "請求",
    dyk: "DYK",
    request_games: "請求·遊戲",
    request_anime_and_manga: "請求·動漫",
    "5_content_review": "(5) 內容評審",
    review: "評審",
    quick_review: "快評",
    writing_review: "文筆評審",
    writing_quick_review: "文筆快評",
    coverage_review: "覆蓋面評審",
    coverage_quick_review: "覆蓋面快評",
    source_formatting_review: "來源格式評審",
    source_formatting_quick_review: "來源格式快評",
    complete_review: "完整評審",
    b_class_review: "乙級評審",
    b_class_quick_review: "乙級快評",
    b_class_writing_review: "乙級文筆評審",
    b_class_writing_quick_review: "乙級文筆快評",
    b_class_coverage_review: "乙級覆蓋面評審",
    b_class_coverage_quick_review: "乙級覆蓋面快評",
    b_class_source_formatting_review: "乙級來源格式評審",
    b_class_source_formatting_quick_review: "乙級來源格式快評",
    complete_b_class_review: "完整乙級評審",
    good_article_review_2: "優良評審",
    good_article_quick_review: "優良快評",
    good_article_writing_review: "優良文筆評審",
    good_article_writing_quick_review: "優良文筆快評",
    good_article_coverage_review: "優良覆蓋面評審",
    good_article_coverage_quick_review: "優良覆蓋面快評",
    good_article_source_formatting_review: "優良來源格式評審",
    good_article_source_formatting_quick_review: "優良來源格式快評",
    complete_good_article_review: "完整優良評審",
    a_class_review: "甲級評審",
    a_class_quick_review: "甲級快評",
    a_class_writing_review: "甲級文筆評審",
    a_class_writing_quick_review: "甲級文筆快評",
    a_class_coverage_review: "甲級覆蓋面評審",
    a_class_coverage_quick_review: "甲級覆蓋面快評",
    a_class_source_formatting_review: "甲級來源格式評審",
    a_class_source_formatting_quick_review: "甲級來源格式快評",
    complete_a_class_review: "完整甲級評審",
    featured_article_review_2: "典特評審",
    featured_article_quick_review: "典特快評",
    featured_article_writing_review: "典特文筆評審",
    featured_article_writing_quick_review: "典特文筆快評",
    featured_article_coverage_review: "典特覆蓋面評審",
    featured_article_coverage_quick_review: "典特覆蓋面快評",
    featured_article_source_formatting_review: "典特來源格式評審",
    featured_article_source_formatting_quick_review: "典特來源格式快評",
    complete_featured_article_review: "完整典特評審",
    "6_media": "(6) 檔案",
    freely_licensed_media_uploaded_to_wikimedia_commons_enter_the_filename:
        "上載至Wikimedia Commons的自由版權項目。頁面名填寫檔案名（含File:前綴）或使用檔案的條目名，足以核對即可。",
    media: "媒體",
    featured_picture: "特色圖片",
    "7_nominating_others": "(7) 他薦",
    each_valid_nomination_of_another_editor_earns_0_5_points:
        "每有效提名他人 1 次得 0.5 分，每人每月最多得 5 分。若多次得分，請自行定義分數。",
    nominating_others: "他薦",
    "8_other": "(8) 其他",
    recognizes_other_contributions_that_are_difficult_to_quantify_enter_a:
        "獎勵維基人做出的其他難以量化的貢獻。請手動填寫理由和分數。實際得分或由專題成員商討得出。",
    other: "其他",
} as const;

type RuleMessageKey = keyof typeof CANONICAL_RULE_MESSAGES;
export type RuleTranslator = (key: RuleMessageKey) => string;
export const canonicalRuleMessage: RuleTranslator = (key) =>
    CANONICAL_RULE_MESSAGES[key];

export const RULE_GROUPS = [
    {
        section: "article",
        type: "content",
        groupKey: "content_expansion",
        explanationKey: "add_or_expand_article_content_new_content_of_at_least",
        rules: [
            {
                rule: "1a",
                labelKey: "short_expansion",
                score: 1,
            },
            {
                rule: "1b",
                labelKey: "medium_expansion",
                score: 2,
            },
            {
                rule: "1c",
                labelKey: "long_expansion",
                score: 3,
            },
        ],
    },
    {
        section: "article",
        type: "quality",
        groupKey: "quality_improvement",
        explanationKey:
            "choose_the_article_s_quality_class_before_and_after_improvement",
        rules: [
            {
                rule: "2-c",
                labelKey: "c_class",
                score: 1,
            },
            {
                rule: "2-b",
                labelKey: "b_class",
                score: 3,
            },
            {
                rule: "2-ga",
                labelKey: "good_article",
                score: 5,
            },
            {
                rule: "2-fa",
                labelKey: "featured_article",
                score: 10,
            },
        ],
    },
    {
        section: "article",
        type: "format",
        groupKey: "formatting",
        explanationKey:
            "recognizes_well_formatted_articles_editors_below_creation_award_level_5",
        rules: [
            {
                rule: "3",
                labelKey: "formatting",
                score: 1,
            },
        ],
    },
    {
        section: "article",
        type: "activity",
        groupKey: "4_activities",
        explanationKey: null,
        rules: [
            {
                rule: "4",
                labelKey: "activity",
                score: 1,
            },
            {
                rule: "4-req",
                labelKey: "request",
                score: 1,
            },
            {
                rule: "4-dyk",
                labelKey: "dyk",
                score: 1,
            },
            {
                rule: "4-req-game",
                labelKey: "request_games",
                score: 1,
            },
            {
                rule: "4-req-ac",
                labelKey: "request_anime_and_manga",
                score: 1,
            },
        ],
    },
    {
        section: "review",
        type: "review",
        groupKey: "5_content_review",
        explanationKey: null,
        rules: [
            {
                rule: "5",
                labelKey: "review",
                score: 1,
            },
            {
                rule: "5-half",
                labelKey: "quick_review",
                score: 0.5,
            },
            {
                rule: "5a",
                labelKey: "writing_review",
                score: 1,
            },
            {
                rule: "5a-half",
                labelKey: "writing_quick_review",
                score: 0.5,
            },
            {
                rule: "5b",
                labelKey: "coverage_review",
                score: 1,
            },
            {
                rule: "5b-half",
                labelKey: "coverage_quick_review",
                score: 0.5,
            },
            {
                rule: "5c",
                labelKey: "source_formatting_review",
                score: 1,
            },
            {
                rule: "5c-half",
                labelKey: "source_formatting_quick_review",
                score: 0.5,
            },
            {
                rule: "5x",
                labelKey: "complete_review",
                score: 3,
            },
            {
                rule: "5-bcr",
                labelKey: "b_class_review",
                score: 1,
            },
            {
                rule: "5-bcr-half",
                labelKey: "b_class_quick_review",
                score: 0.5,
            },
            {
                rule: "5a-bcr",
                labelKey: "b_class_writing_review",
                score: 1,
            },
            {
                rule: "5a-bcr-half",
                labelKey: "b_class_writing_quick_review",
                score: 0.5,
            },
            {
                rule: "5b-bcr",
                labelKey: "b_class_coverage_review",
                score: 1,
            },
            {
                rule: "5b-bcr-half",
                labelKey: "b_class_coverage_quick_review",
                score: 0.5,
            },
            {
                rule: "5c-bcr",
                labelKey: "b_class_source_formatting_review",
                score: 1,
            },
            {
                rule: "5c-bcr-half",
                labelKey: "b_class_source_formatting_quick_review",
                score: 0.5,
            },
            {
                rule: "5x-bcr",
                labelKey: "complete_b_class_review",
                score: 3,
            },
            {
                rule: "5-gan",
                labelKey: "good_article_review_2",
                score: 1,
            },
            {
                rule: "5-gan-half",
                labelKey: "good_article_quick_review",
                score: 0.5,
            },
            {
                rule: "5a-gan",
                labelKey: "good_article_writing_review",
                score: 1,
            },
            {
                rule: "5a-gan-half",
                labelKey: "good_article_writing_quick_review",
                score: 0.5,
            },
            {
                rule: "5b-gan",
                labelKey: "good_article_coverage_review",
                score: 1,
            },
            {
                rule: "5b-gan-half",
                labelKey: "good_article_coverage_quick_review",
                score: 0.5,
            },
            {
                rule: "5c-gan",
                labelKey: "good_article_source_formatting_review",
                score: 1,
            },
            {
                rule: "5c-gan-half",
                labelKey: "good_article_source_formatting_quick_review",
                score: 0.5,
            },
            {
                rule: "5x-gan",
                labelKey: "complete_good_article_review",
                score: 3,
            },
            {
                rule: "5-acr",
                labelKey: "a_class_review",
                score: 2,
            },
            {
                rule: "5-acr-half",
                labelKey: "a_class_quick_review",
                score: 1,
            },
            {
                rule: "5a-acr",
                labelKey: "a_class_writing_review",
                score: 2,
            },
            {
                rule: "5a-acr-half",
                labelKey: "a_class_writing_quick_review",
                score: 1,
            },
            {
                rule: "5b-acr",
                labelKey: "a_class_coverage_review",
                score: 2,
            },
            {
                rule: "5b-acr-half",
                labelKey: "a_class_coverage_quick_review",
                score: 1,
            },
            {
                rule: "5c-acr",
                labelKey: "a_class_source_formatting_review",
                score: 2,
            },
            {
                rule: "5c-acr-half",
                labelKey: "a_class_source_formatting_quick_review",
                score: 1,
            },
            {
                rule: "5x-acr",
                labelKey: "complete_a_class_review",
                score: 6,
            },
            {
                rule: "5-fac",
                labelKey: "featured_article_review_2",
                score: 2,
            },
            {
                rule: "5-fac-half",
                labelKey: "featured_article_quick_review",
                score: 1,
            },
            {
                rule: "5a-fac",
                labelKey: "featured_article_writing_review",
                score: 2,
            },
            {
                rule: "5a-fac-half",
                labelKey: "featured_article_writing_quick_review",
                score: 1,
            },
            {
                rule: "5b-fac",
                labelKey: "featured_article_coverage_review",
                score: 2,
            },
            {
                rule: "5b-fac-half",
                labelKey: "featured_article_coverage_quick_review",
                score: 1,
            },
            {
                rule: "5c-fac",
                labelKey: "featured_article_source_formatting_review",
                score: 2,
            },
            {
                rule: "5c-fac-half",
                labelKey: "featured_article_source_formatting_quick_review",
                score: 1,
            },
            {
                rule: "5x-fac",
                labelKey: "complete_featured_article_review",
                score: 6,
            },
        ],
    },
    {
        section: "other",
        type: "media",
        groupKey: "6_media",
        explanationKey:
            "freely_licensed_media_uploaded_to_wikimedia_commons_enter_the_filename",
        rules: [
            {
                rule: "6",
                labelKey: "media",
                score: 3,
            },
            {
                rule: "6-fp",
                labelKey: "featured_picture",
                score: 5,
            },
        ],
    },
    {
        section: "other",
        type: "recommendation",
        groupKey: "7_nominating_others",
        explanationKey:
            "each_valid_nomination_of_another_editor_earns_0_5_points",
        rules: [
            {
                rule: "7",
                labelKey: "nominating_others",
                score: 0.5,
            },
        ],
    },
    {
        section: "other",
        type: "other",
        groupKey: "8_other",
        explanationKey:
            "recognizes_other_contributions_that_are_difficult_to_quantify_enter_a",
        rules: [
            {
                rule: "8",
                labelKey: "other",
                score: 0,
            },
        ],
    },
] as const;
