/**
 * 自动分页器：将连续内容按固定页面高度自动拆分为多页
 * 核心约束：不在文字行中间断开，只在块级元素边界处分页
 *
 * 方案：创建离屏测量容器（无 overflow 约束），在其中精确测量内容高度和子元素位置，
 *       将分页结果转换为元素索引，再用索引拆分原始 DOM。
 */
export class AutoPaginator {

    static paginate(element: HTMLElement): void {
        const imagePreview = element.querySelector('.red-image-preview') as HTMLElement;
        if (!imagePreview) return;

        const sections = Array.from(
            element.querySelectorAll<HTMLElement>('.red-content-section')
        );
        if (sections.length === 0) return;

        // 记录分页前的原始尺寸
        const originalRect = imagePreview.getBoundingClientRect();
        const cs = getComputedStyle(imagePreview);
        const paddingTop = parseFloat(cs.paddingTop) || 0;
        const paddingBottom = parseFloat(cs.paddingBottom) || 0;
        const paddingLeft = parseFloat(cs.paddingLeft) || 0;
        const paddingRight = parseFloat(cs.paddingRight) || 0;

        const targetWidth = originalRect.width - paddingLeft - paddingRight;
        const targetHeight = originalRect.height - paddingTop - paddingBottom;

        if (targetWidth <= 0 || targetHeight <= 0) return;

        sections.forEach(section => {
            this.paginateSection(section, targetWidth, targetHeight,
                paddingLeft, paddingRight, paddingTop, paddingBottom, imagePreview);
        });
    }

    private static paginateSection(
        section: HTMLElement,
        targetWidth: number,
        targetHeight: number,
        paddingLeft: number,
        paddingRight: number,
        paddingTop: number,
        paddingBottom: number,
        imagePreview: HTMLElement
    ): void {
        section.style.display = 'block';
        section.classList.add('red-section-active');

        // 创建离屏测量容器
        const measureContainer = document.createElement('div');
        measureContainer.style.cssText = `
            position: fixed;
            top: -99999px;
            left: 0;
            width: ${targetWidth}px;
            padding: ${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px;
            z-index: -1;
            visibility: hidden;
            pointer-events: none;
            box-sizing: content-box;
        `;

        const previewCS = getComputedStyle(imagePreview);
        measureContainer.style.fontFamily = previewCS.fontFamily;
        measureContainer.style.fontSize = previewCS.fontSize;
        measureContainer.style.lineHeight = previewCS.lineHeight;

        // 克隆 section 内容
        const clonedSection = section.cloneNode(true) as HTMLElement;
        clonedSection.style.display = 'block';
        clonedSection.style.margin = '0';
        measureContainer.appendChild(clonedSection);
        document.body.appendChild(measureContainer);

        try {
            const totalHeight = this.measureTotalContentHeight(clonedSection);
            if (totalHeight <= targetHeight + 5) return;

            // 在离屏容器中计算分页断点（像素偏移）
            const breakOffsets = this.calculateBreakOffsets(clonedSection, targetHeight, totalHeight);
            if (breakOffsets.length === 0) return;

            // 将像素断点转换为元素索引断点
            const breakIndices = this.offsetsToIndices(clonedSection, breakOffsets);
            if (breakIndices.length === 0) return;

            // 用索引拆分原始 section 的子元素
            const pageGroups = this.distributeElementsByIndex(section, breakIndices);
            this.rebuildSection(section, pageGroups);
        } finally {
            document.body.removeChild(measureContainer);
        }
    }

    private static measureTotalContentHeight(section: HTMLElement): number {
        const children = Array.from(section.children);
        if (children.length === 0) return 0;

        const sectionTop = section.getBoundingClientRect().top;
        let maxBottom = 0;
        for (const child of children) {
            const bottom = child.getBoundingClientRect().bottom - sectionTop;
            if (bottom > maxBottom) maxBottom = bottom;
        }
        return maxBottom;
    }

    /**
     * 计算分页断点（像素偏移，基于离屏容器）
     */
    private static calculateBreakOffsets(
        section: HTMLElement,
        pageHeight: number,
        totalHeight: number
    ): number[] {
        const breaks: number[] = [];
        let currentY = pageHeight;
        const sectionTop = section.getBoundingClientRect().top;

        while (currentY < totalHeight - 20) {
            const safeY = this.findSafeBreakY(section, currentY, sectionTop);

            const lastBreak = breaks.length > 0 ? breaks[breaks.length - 1] : 0;
            if (safeY <= lastBreak + 20) {
                const forced = this.forceNextBreak(section, safeY, sectionTop);
                if (forced <= lastBreak + 20) break;
                breaks.push(forced);
                currentY = forced + pageHeight;
            } else {
                breaks.push(safeY);
                currentY = safeY + pageHeight;
            }
        }
        return breaks;
    }

    private static findSafeBreakY(
        section: HTMLElement,
        theoreticalY: number,
        sectionTop: number
    ): number {
        const children = Array.from(section.children);
        if (children.length === 0) return theoreticalY;

        let lastEndBefore = 0;
        let lastEndBeforeIndex = -1;

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const childTop = child.getBoundingClientRect().top - sectionTop;
            const childBottom = child.getBoundingClientRect().bottom - sectionTop;

            if (childBottom <= theoreticalY + 2) {
                lastEndBefore = childBottom;
                lastEndBeforeIndex = i;
            } else if (childTop >= theoreticalY - 2) {
                return this.adjustForHeading(children, i, childTop, sectionTop);
            } else {
                return this.adjustForHeading(children, i, childTop, sectionTop);
            }
        }
        return lastEndBefore > 20 ? lastEndBefore : theoreticalY;
    }

    /**
     * 标题不孤悬规则：如果断点后的元素是标题（h1-h6），
     * 将断点移到标题之前，让标题跟随下一页
     */
    private static adjustForHeading(
        children: Element[],
        nextIndex: number,
        breakY: number,
        sectionTop: number
    ): number {
        // 检查断点后的元素是否是标题
        if (nextIndex < children.length) {
            const nextEl = children[nextIndex];
            const tag = nextEl.tagName.toLowerCase();
            if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
                // 标题在断点附近 → 保持断在标题之前（标题到下一页）
                return breakY;
            }
        }

        // 检查断点前的最后一个元素是否是标题（标题孤悬在页底）
        if (nextIndex > 0) {
            const prevEl = children[nextIndex - 1];
            const tag = prevEl.tagName.toLowerCase();
            if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
                // 标题在页底孤悬 → 把断点移到标题之前
                const headingTop = prevEl.getBoundingClientRect().top - sectionTop;
                // 确保当前页还有足够内容（至少保留页高的一半）
                const pageHalf = (breakY - headingTop) > 50;
                if (pageHalf && headingTop > 50) {
                    return headingTop;
                }
            }
        }

        return breakY;
    }

    private static forceNextBreak(
        section: HTMLElement,
        afterY: number,
        sectionTop: number
    ): number {
        for (const child of Array.from(section.children)) {
            const childBottom = child.getBoundingClientRect().bottom - sectionTop;
            if (childBottom > afterY + 20) return childBottom;
        }
        return afterY;
    }

    /**
     * 将像素断点转换为子元素索引
     * 返回的每个值是"从此索引开始属于下一页"
     */
    private static offsetsToIndices(
        section: HTMLElement,
        breakOffsets: number[]
    ): number[] {
        const children = Array.from(section.children);
        const sectionTop = section.getBoundingClientRect().top;
        const indices: number[] = [];

        for (const breakY of breakOffsets) {
            // 找到第一个 bottom > breakY 的子元素索引
            let breakIndex = children.length; // 默认：断点后没有元素
            for (let i = 0; i < children.length; i++) {
                const childBottom = children[i].getBoundingClientRect().bottom - sectionTop;
                if (childBottom > breakY + 2) {
                    breakIndex = i;
                    break;
                }
            }
            // 只有当断点后有元素时才加入
            if (breakIndex < children.length && breakIndex > 0) {
                indices.push(breakIndex);
            }
        }

        // 去重
        return [...new Set(indices)];
    }

    /**
     * 用元素索引将原始 section 的子元素分组到各页
     */
    private static distributeElementsByIndex(
        section: HTMLElement,
        breakIndices: number[]
    ): Element[][] {
        const children = Array.from(section.children);
        const pages: Element[][] = [];
        let start = 0;

        for (const breakIdx of breakIndices) {
            pages.push(children.slice(start, breakIdx));
            start = breakIdx;
        }
        // 最后一页：从最后一个断点到末尾
        pages.push(children.slice(start));

        return pages.filter(p => p.length > 0);
    }

    private static rebuildSection(
        section: HTMLElement,
        pageGroups: Element[][]
    ): void {
        const parent = section.parentElement;
        if (!parent) return;

        const originalIndex = section.dataset.index || '0';

        // 清除 inline display，让 CSS class 控制显示/隐藏
        section.style.display = '';

        while (section.firstChild) {
            section.removeChild(section.firstChild);
        }

        if (pageGroups.length > 0) {
            pageGroups[0].forEach(el => section.appendChild(el));
        }

        let insertAfter: Node = section;
        for (let i = 1; i < pageGroups.length; i++) {
            const newSection = document.createElement('section');
            newSection.className = 'red-content-section';
            newSection.dataset.index = `${originalIndex}-${i}`;
            pageGroups[i].forEach(el => newSection.appendChild(el));

            if (insertAfter.nextSibling) {
                parent.insertBefore(newSection, insertAfter.nextSibling);
            } else {
                parent.appendChild(newSection);
            }
            insertAfter = newSection;
        }
    }
}
