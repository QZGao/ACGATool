/**
 * 按文件順序將提名表格歸入最近的三級章節，不依賴標題與表格是兄弟節點。
 * Convenient Discussions 等小工具可插入任意包裝層；表格本身的模板 class 仍是定位依據。
 * 編輯器中的預覽、提名表內的巢狀表格或標題都不參與原頁面的章節與表格定位。
 * @param {Element} root 登記處內容區。
 * @returns {Array<{heading: Element, tables: Element[]}>} 原始章節與依頁面順序排列的提名表。
 */
export function getNominationSections(root) {
    const sections = [];
    let current = null;
    for (const element of root.querySelectorAll('h1, h2, h3, table.acgnom-table')) {
        if (element.closest('.acga-editor') || element.parentElement?.closest('table.acgnom-table')) continue;
        if (element.matches('h1, h2')) {
            current = null;
        } else if (element.matches('h3')) {
            current = {heading: element, tables: []};
            sections.push(current);
        } else if (current) {
            current.tables.push(element);
        }
    }
    return sections;
}
