import type { ImgTemplate } from '../../imgTemplateManager';
import type { SettingsManager } from '../../settings/settings';
import type { ThemeManager } from '../../themeManager';
import { AutoPaginator } from '../../autoPaginator';

/**
 * 智能分割排版：无需标题分割，自动按内容高度分页
 * 用户自由写作，系统自动计算断页位置
 */
export class FreeTemplate implements ImgTemplate {
    id = 'free';
    name = '默认排版';
    category: 'heading' | 'free' = 'free';
    sections = {
        header: false,
        content: true as const,
        footer: false
    };

    constructor(
        private settingsManager: SettingsManager,
        private onSettingsUpdate: () => Promise<void>,
        private themeManager: ThemeManager
    ) {}

    render(element: HTMLElement) {
        // 移除空的 header 和 footer（自由排版不需要）
        const header = element.querySelector('.red-preview-header');
        if (header) header.remove();
        const footer = element.querySelector('.red-preview-footer');
        if (footer) footer.remove();

        // 先应用主题（确保测量准确），然后分页，再对每页重新应用主题
        this.themeManager.applyTheme(element);
        AutoPaginator.paginate(element);
        this.reapplyThemesToAllSections(element);
    }

    private reapplyThemesToAllSections(element: HTMLElement) {
        // 分页后可能产生新的 section，重新应用主题确保样式一致
        this.themeManager.applyTheme(element);
    }
}
