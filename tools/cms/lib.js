// CMS 自定义界面的共享代码（浏览器端）。构建把它拼在 tools/cms/admin.js 的最前面，
// 写成 dist/admin/admin.js，由 admin/index.html 加载。
// 提供：模板目录的加载与检索、「分类 + 搜索 + 预览」选择器、往 CMS 自带的富文本编辑器里写正文、
// 打开右侧的「别名」面板、物品清单的检索。
// 这段代码靠认出 CMS 编辑器内部的结构来工作（字段容器的 data-* 属性、工具栏按钮、正文输入框），
// CMS 升级后要重新确认。
window.CmsUi = (() => {
  const { useState, useEffect, useRef, useMemo } = CMS.React;

  // ---------- 样式 ----------
  // CMS 给 button、input 等元素设了全局样式，这里的每个元素都显式写全，并限定在 .tsx-* 之下。
  // 颜色取自 CMS 自己的 --sui-* 变量（定义在 :root 上），所以深色、浅色主题都跟着 CMS 走；
  // 每个变量都带回退值。只有预览区固定是浅色的，像一张 wiki 页面。
  const STYLE_ID = 'cms-ui-style';
  const THEME_VARS = `
    --tx-fg: var(--sui-textbox-foreground-color, #1f2330);
    --tx-fg-2: var(--sui-secondary-foreground-color, #5b6270);
    --tx-fg-3: var(--sui-tertiary-foreground-color, #8a91a0);
    --tx-bg: var(--sui-content-background-color, #ffffff);
    --tx-bg-2: var(--sui-secondary-background-color, #f1f3f7);
    --tx-border: var(--sui-textbox-border-color, #c4cad6);
    --tx-hover: var(--sui-hover-background-color, #eef0f4);
    --tx-selected: var(--sui-selected-background-color, #e4ecfd);
    --tx-input-bg: var(--sui-textbox-background-color, #ffffff);
    --tx-radius: var(--sui-control-medium-border-radius, 6px);
    /* CMS 自己的蓝色主色（「保存」按钮那种）及其配套值 */
    --tx-accent: var(--sui-primary-accent-color, #2563eb);
    --tx-accent-hover: var(--sui-primary-accent-color-dark, #1d4ed8);
    --tx-accent-fg: var(--sui-primary-accent-color-inverted, #ffffff);
    --tx-accent-soft: var(--sui-primary-accent-color-translucent-light, rgba(37, 99, 235, .2));
    --tx-paper-fg: #1f2330;
    --tx-paper-fg-2: #5b6270;
    --tx-paper-border: #c4cad6;
    --tx-paper-bg-2: #f1f3f7;
    --tx-paper-code: #eef0f4;
`;
  const css = `
.tsx-root, .tsx-overlay { ${THEME_VARS} }
.tsx-root, .tsx-overlay, .tsx-overlay * { box-sizing: border-box; }
.tsx-root, .tsx-overlay {
  font: 14px/1.6 system-ui, "Microsoft YaHei", sans-serif; color: var(--tx-fg); text-align: left;
}
/* CMS 给 button、input 设了全局样式（灰色、白字、固定字体），这里重置掉。:where() 的特异性是 0，
   所以下面的 .tsx-* 规则都能覆盖这里的值。 */
:where(.tsx-root, .tsx-overlay) button {
  font: inherit; color: inherit; appearance: none; width: auto; min-width: 0; height: auto; margin: 0;
}
:where(.tsx-root, .tsx-overlay) input { font: inherit; appearance: none; }

.tsx-btn {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  padding: 5px 14px; border: 1px solid var(--tx-border); border-radius: var(--tx-radius);
  background: var(--tx-input-bg); color: var(--tx-fg);
}
.tsx-btn:hover:not(:disabled) { background: var(--tx-hover); }
.tsx-btn:disabled { cursor: not-allowed; opacity: .55; }
.tsx-btn-primary { background: var(--tx-accent); border-color: transparent; color: var(--tx-accent-fg); font-weight: 600; }
.tsx-btn-primary:hover:not(:disabled) { background: var(--tx-accent-hover); color: var(--tx-accent-fg); }
.tsx-btn-danger { background: #dc2626; border-color: transparent; color: #fff; font-weight: 600; }
.tsx-btn-danger:hover:not(:disabled) { background: #b91c1c; color: #fff; }
.tsx-btn-big { padding: 7px 20px; font-size: 15px; }
.tsx-icon-btn {
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex: none;
  width: 30px; height: 30px; padding: 0; border: 1px solid transparent; border-radius: var(--tx-radius);
  background: transparent; color: var(--tx-fg); font-size: 16px; line-height: 1;
}
.tsx-icon-btn:hover { background: var(--tx-hover); }
.tsx-search {
  flex: 1; min-width: 120px; padding: 5px 10px; border: 1px solid var(--tx-border); border-radius: var(--tx-radius);
  background: var(--tx-input-bg); color: var(--tx-fg); outline: none;
}
.tsx-search:focus { border-color: var(--tx-accent); box-shadow: 0 0 0 2px var(--tx-accent-soft); }
.tsx-search::placeholder { color: var(--tx-fg-3); }
.tsx-text {
  width: 100%; padding: 6px 10px; border: 1px solid var(--tx-border); border-radius: var(--tx-radius);
  background: var(--tx-input-bg); color: var(--tx-fg); outline: none;
}
.tsx-text:focus { border-color: var(--tx-accent); box-shadow: 0 0 0 2px var(--tx-accent-soft); }
.tsx-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tsx-note { color: var(--tx-fg-2); font-size: 12px; }
.tsx-error { color: #f87171; font-size: 13px; }
.tsx-ok { color: #4ade80; font-size: 13px; }
.tsx-warn {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: var(--tx-radius);
  background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; font-size: 13px; text-align: left;
}
.tsx-count { color: var(--tx-fg-3); font-size: 12px; white-space: nowrap; }

/* 选择器：上方搜索框，下面三栏（分类 / 列表 / 预览） */
.tsx-picker { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.tsx-picker-search { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--tx-border); }
.tsx-picker-body { display: flex; flex: 1; min-height: 0; }
.tsx-cats { flex: 0 0 160px; border-right: 1px solid var(--tx-border); padding: 8px; overflow: auto; background: var(--tx-bg-2); }
.tsx-cat {
  display: flex; justify-content: space-between; gap: 8px; width: 100%; text-align: left; cursor: pointer;
  padding: 5px 10px; margin: 2px 0; border: 0; border-radius: var(--tx-radius); background: transparent; color: var(--tx-fg);
}
.tsx-cat:hover { background: var(--tx-hover); }
.tsx-cat[aria-pressed="true"] { background: var(--tx-accent); color: var(--tx-accent-fg); }
.tsx-list { flex: 0 0 270px; border-right: 1px solid var(--tx-border); overflow: auto; overflow-x: hidden; padding: 8px; }
.tsx-item {
  display: block; width: 100%; text-align: left; cursor: pointer; padding: 7px 10px; margin: 2px 0;
  border: 0; border-radius: var(--tx-radius); background: transparent; color: var(--tx-fg);
}
.tsx-item:hover { background: var(--tx-hover); }
.tsx-item[aria-selected="true"] { background: var(--tx-selected); box-shadow: inset 3px 0 0 var(--tx-accent); }
.tsx-item-title { display: block; font-weight: 600; }
.tsx-item-desc { display: block; font-size: 12px; color: var(--tx-fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tsx-item-badge {
  display: inline-block; margin-left: 6px; padding: 0 5px; border-radius: 4px; background: var(--tx-bg-2);
  font-size: 11px; font-weight: 400; color: var(--tx-fg-2); vertical-align: 1px;
}
.tsx-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.tsx-main-head { padding: 10px 14px; border-bottom: 1px solid var(--tx-border); background: var(--tx-bg-2); }
.tsx-main-head h3 { margin: 0; font-size: 15px; }
.tsx-main-head p { margin: 2px 0 0; color: var(--tx-fg-2); font-size: 12px; }
.tsx-empty { padding: 24px 14px; color: var(--tx-fg-2); }

/* 预览区固定是浅色的：像一张 wiki 页面 */
.tsx-preview {
  flex: 1; min-height: 0; overflow: auto; padding: 14px 18px 28px;
  background: #fff; color: var(--tx-paper-fg);
  --tx-fg: var(--tx-paper-fg); --tx-fg-2: var(--tx-paper-fg-2); --tx-border: var(--tx-paper-border);
}
.tsx-preview > :first-child { margin-top: 0; }
.tsx-preview h1, .tsx-preview h2, .tsx-preview h3, .tsx-preview h4 { margin: 18px 0 8px; line-height: 1.3; }
.tsx-preview h2 { font-size: 19px; border-bottom: 1px solid var(--tx-paper-border); padding-bottom: 4px; }
.tsx-preview h3 { font-size: 16px; }
.tsx-preview p { margin: 8px 0; }
.tsx-preview ul, .tsx-preview ol { margin: 8px 0; padding-left: 26px; }
.tsx-preview li { margin: 2px 0; }
.tsx-preview table { border-collapse: collapse; margin: 10px 0; font-size: 13px; }
.tsx-preview th, .tsx-preview td { border: 1px solid var(--tx-paper-border); padding: 4px 10px; text-align: left; }
.tsx-preview th { background: var(--tx-paper-bg-2); }
.tsx-preview blockquote { margin: 10px 0; padding: 6px 12px; border-left: 4px solid #f59e0b; background: #fffbeb; }
.tsx-preview code { font-family: Consolas, monospace; font-size: 13px; background: var(--tx-paper-code); padding: 1px 4px; border-radius: 3px; }
.tsx-preview a { color: #2563eb; }

/* 全屏小窗 */
.tsx-overlay {
  position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: rgba(15, 18, 25, .55);
}
.tsx-dialog {
  display: flex; flex-direction: column; width: min(980px, 100%); height: min(640px, 100%);
  background: var(--tx-bg); color: var(--tx-fg); border: 1px solid var(--tx-border); border-radius: 10px; overflow: hidden;
  box-shadow: 0 18px 50px rgba(0, 0, 0, .35);
}
.tsx-dialog-head { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--tx-border); }
.tsx-dialog-head h2 { margin: 0; font-size: 16px; white-space: nowrap; }
.tsx-dialog-head .tsx-spacer, .tsx-dialog-foot .tsx-spacer { flex: 1; }
.tsx-dialog-foot { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--tx-border); }

/* 「从模板开始」：按钮和它旁边的一行说明 */
.tsx-starter { display: flex; flex-direction: column; gap: 6px; padding: 2px 0; }

/* 模板按钮不在表单里占一个字段，而是装到正文字段的标题行上（tools/cms/admin.js）。它自己的字段外壳
   不生成盒子：标题行和「⋮」隐藏，其余部分 display: contents，这样上下两个字段之间不会多出一条分隔线，
   也不会留下空白。小窗是 position: fixed 的，照样能显示。 */
[data-field-type="template-starter"] > header,
[data-field-type="template-starter"] > .footer { display: none !important; }
[data-field-type="template-starter"],
[data-field-type="template-starter"] > .field-wrapper,
[data-field-type="template-starter"] > .field-wrapper > div { display: contents; }
[data-field-type="markdown"] > header h4 { white-space: nowrap; flex: none; }
.tsx-starter-bar { display: inline-flex; align-items: center; gap: 8px; margin-left: 12px; min-width: 0; flex: 0 1 auto; overflow: hidden; }
/* !important：字段自己的样式是「没有悬停或焦点时，标题行里的按钮一律透明」（CMS 的「⋮」菜单就是这样
   只在悬停时出现的），特异性比这里的高，所以按钮要显式顶回去。 */
.tsx-starter-btn {
  appearance: none; font: 12px/1 system-ui, "Microsoft YaHei", sans-serif; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px; width: auto; height: auto; margin: 0;
  padding: 3px 10px; border: 1px solid var(--tx-border); border-radius: var(--tx-radius);
  background: var(--tx-input-bg); color: var(--tx-fg); opacity: 1 !important;
  flex: none; white-space: nowrap;
}
[data-field-type="markdown"] > header { --tx-fg: var(--sui-textbox-foreground-color, #1f2330); --tx-fg-2: var(--sui-secondary-foreground-color, #5b6270); --tx-border: var(--sui-textbox-border-color, #c4cad6); --tx-input-bg: var(--sui-textbox-background-color, #ffffff); --tx-radius: var(--sui-control-medium-border-radius, 6px); }
.tsx-starter-btn:hover:not(:disabled) { background: var(--sui-hover-background-color, #eef0f4); }
.tsx-starter-btn:disabled { cursor: not-allowed; opacity: .55; }
.tsx-starter-note { font: 12px/1.4 system-ui, "Microsoft YaHei", sans-serif; color: var(--tx-fg-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 状态文字的配色跟着 CMS 的主题走（它在 :root 上设置 color-scheme） */
.tsx-starter-note.is-ok { color: light-dark(#15803d, #4ade80); }
.tsx-starter-note.is-warn { color: light-dark(#b45309, #fbbf24); }
.tsx-starter-note.is-error { color: light-dark(#b91c1c, #f87171); }
/* 「文件名」这一项。警告文字的配色跟着 CMS 的主题走 */
[data-field-type="filename-hint"] > header button { display: none; }
.tsx-filename { display: flex; flex-direction: column; gap: 6px; }
.tsx-filename code { font-family: Consolas, monospace; font-size: 13px; background: var(--tx-bg-2); padding: 1px 4px; border-radius: 3px; }
.tsx-filename .tsx-note-warn { color: light-dark(#b45309, #fbbf24); }

/* 向导页的样式（站点现在没有用到，留着） */
.tsx-wizard { display: flex; flex-direction: column; min-height: 100%; padding: 18px 28px 0; gap: 14px; }
.tsx-wizard-lead { margin: 0; color: var(--tx-fg-2); }
.tsx-steps { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0; padding: 0; }
.tsx-step {
  display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px 4px 6px; border-radius: 999px;
  color: var(--tx-fg-2); background: transparent; border: 0; cursor: pointer;
}
.tsx-step:disabled { cursor: default; opacity: .6; }
.tsx-step-num {
  display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex: none;
  border-radius: 50%; background: var(--tx-bg-2); color: var(--tx-fg-2); font-size: 12px; font-weight: 600;
}
.tsx-step[aria-current="step"] { background: var(--tx-bg-2); color: var(--tx-fg); font-weight: 600; }
.tsx-step[aria-current="step"] .tsx-step-num { background: var(--tx-accent); color: var(--tx-accent-fg); }
.tsx-step-done .tsx-step-num { background: #16a34a; color: #fff; }
.tsx-step-arrow { color: var(--tx-fg-3); }
.tsx-panel {
  display: flex; flex-direction: column; min-height: 220px;
  border: 1px solid var(--tx-border); border-radius: 10px; overflow: hidden;
}
/* The step that holds the template picker: a bounded height, so the picker's three columns scroll
   inside instead of the page growing with the number of templates. 370px is roughly what the CMS
   toolbar, the page title, the wizard's own header and its button bar take up on a short screen. */
.tsx-panel-tall { height: max(280px, calc(100vh - 370px)); min-height: 0; max-height: 640px; }
.tsx-panel-head { padding: 12px 16px; border-bottom: 1px solid var(--tx-border); }
.tsx-panel-head h2 { margin: 0; font-size: 17px; }
.tsx-panel-head p { margin: 2px 0 0; color: var(--tx-fg-2); }
.tsx-choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; padding: 16px; }
.tsx-choice {
  display: flex; gap: 10px; align-items: flex-start; text-align: left; cursor: pointer; padding: 12px 14px;
  border: 1px solid var(--tx-border); border-radius: 10px; background: var(--tx-input-bg); color: var(--tx-fg);
}
.tsx-choice:hover:not(:disabled) { background: var(--tx-hover); }
.tsx-choice[aria-checked="true"] { border-color: var(--tx-accent); box-shadow: 0 0 0 2px var(--tx-accent-soft); }
.tsx-choice:disabled { cursor: not-allowed; opacity: .5; }
.tsx-choice-dot {
  flex: none; width: 16px; height: 16px; margin-top: 3px; border: 2px solid var(--tx-border); border-radius: 50%;
}
.tsx-choice[aria-checked="true"] .tsx-choice-dot { border-color: var(--tx-accent); background: radial-gradient(circle, var(--tx-accent) 0 45%, transparent 50%); }
.tsx-choice-title { display: block; font-weight: 600; }
.tsx-choice-desc { display: block; color: var(--tx-fg-2); font-size: 12px; }
.tsx-choice-extra { display: block; color: var(--tx-fg-3); font-size: 12px; margin-top: 4px; }
.tsx-skip { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--tx-border); }
/* Buttons stick to the bottom of the scrollable content area, so they are reachable on a short screen */
.tsx-wizard-foot {
  position: sticky; bottom: 0; z-index: 2; display: flex; align-items: center; gap: 10px;
  margin: 0 -28px; padding: 10px 28px; background: var(--tx-bg); border-top: 1px solid var(--tx-border);
}
.tsx-wizard-foot .tsx-spacer { flex: 1; }
.tsx-summary { display: flex; flex-wrap: wrap; gap: 6px 18px; padding: 10px 16px; border: 1px dashed var(--tx-border); border-radius: 10px; color: var(--tx-fg-2); }
.tsx-summary b { color: var(--tx-fg); font-weight: 600; }
`;
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------- 模板目录 ----------
  async function loadCatalog() {
    const res = await fetch('./templates.json');
    if (!res.ok) throw new Error(`模板列表加载失败（HTTP ${res.status}）`);
    return res.json();
  }

  const categoryLabel = (catalog, value) =>
    (catalog.categories.find((c) => c.value === value) || {}).label || value || '';

  function splitQuery(query) {
    return String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  /** Whether a template applies to the given collection types. A template without `applies_to` applies everywhere. */
  const appliesToCollection = (template, appliesTo) => {
    const wanted = appliesTo ? (Array.isArray(appliesTo) ? appliesTo : [appliesTo]) : [];
    if (wanted.length === 0) return true;
    const own = template.applies_to || [];
    return own.length === 0 || own.some((type) => wanted.includes(type));
  };

  /**
   * Search the catalog. `category` is a category value, 'all', or 'applicable' (only the templates that
   * apply to `appliesTo`). Every space-separated word of `query` must match.
   */
  function searchTemplates(catalog, category, query, appliesTo) {
    const words = splitQuery(query);
    return Object.entries(catalog.templates)
      .map(([id, t]) => ({ id, ...t }))
      .filter((t) => category === 'all' || (category === 'applicable' ? appliesToCollection(t, appliesTo) : t.category === category))
      .filter((t) => {
        const haystack = `${t.title}\n${t.description}\n${t.body}`.toLowerCase();
        return words.every((w) => haystack.includes(w));
      });
  }

  // ---------- 预览 ----------
  /** Render a template body as Markdown, through the same pipeline as the CMS preview pane. */
  function Preview({ markdown }) {
    const ref = useRef(null);
    useEffect(() => {
      const el = ref.current;
      if (!el) return undefined;
      el.textContent = '';
      let destroy;
      try {
        destroy = CMS.renderRichText(el, markdown);
      } catch (error) {
        console.error('[cms-ui] renderRichText 失败，退回显示原文', error);
        el.textContent = markdown;
      }
      return () => {
        if (typeof destroy === 'function') destroy();
      };
    }, [markdown]);
    return html`<div class="tsx-preview" ref=${ref}></div>`;
  }

  // ---------- 选择器 ----------
  /**
   * Categories on the left, search box on top, the template list in the middle, a preview on the right.
   * props: catalog, value (selected id, or null), onChange(id), optional onConfirm(template), onCancel(),
   * initialCategory, allowEmpty.
   *
   * By default the selection follows the list: when the selected template is filtered out, the first
   * visible one takes over. With `allowEmpty` (the wizard's "skip" choice), `value` has three states:
   * `undefined` = nothing chosen yet, so the first visible template is selected; `null` = the user
   * chose not to use a template, which is kept; a string = that template.
   */
  function TemplatePicker({
    catalog,
    value,
    onChange,
    onConfirm,
    onCancel,
    initialCategory = 'all',
    allowEmpty = false,
    resetKey = 0,
    appliesTo = null,
  }) {
    const [category, setCategory] = useState(initialCategory);
    const [query, setQuery] = useState('');
    const listRef = useRef(null);
    // The latest callbacks, so the effects below don't re-run when the parent re-renders
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onCancelRef = useRef(onCancel);
    onCancelRef.current = onCancel;
    const onConfirmRef = useRef(onConfirm);
    onConfirmRef.current = onConfirm;

    // The picker can be mounted before the caller knows the category (the wizard keeps every step
    // mounted): follow the initial category when it changes later, and start the search over.
    // `resetKey` lets the caller start over explicitly.
    useEffect(() => {
      setCategory(initialCategory);
      setQuery('');
    }, [initialCategory, resetKey]);

    const counts = useMemo(() => {
      const out = { all: 0, applicable: 0 };
      for (const t of Object.values(catalog.templates)) {
        out[t.category] = (out[t.category] || 0) + 1;
        out.all += 1;
        if (appliesToCollection(t, appliesTo)) out.applicable += 1;
      }
      return out;
    }, [catalog, appliesTo]);

    const shown = useMemo(() => searchTemplates(catalog, category, query, appliesTo), [catalog, category, query, appliesTo]);
    // The selected template, whether or not it is in the filtered list, so searching doesn't blank the preview
    const current = value ? { id: value, ...catalog.templates[value] } : null;

    // Keep the selection in step with what the user sees:
    //  - nothing chosen yet (`undefined`): select the first visible template
    //  - the user chose to skip (`null` in `allowEmpty` mode): keep it, whatever is filtered
    //  - otherwise: when the selected template is filtered out, the first visible one takes over, so
    //    the preview never shows a template that is not in the list. If nothing is visible at all, the
    //    dialog (no `allowEmpty`) drops the selection, while the wizard keeps it: not finding anything
    //    with a search must not throw the user's choice away.
    useEffect(() => {
      if (value === undefined) {
        if (shown[0]) onChangeRef.current(shown[0].id);
        return;
      }
      if (value === null && allowEmpty) return;
      if (shown.some((t) => t.id === value)) return;
      if (shown[0]) onChangeRef.current(shown[0].id);
      else if (!allowEmpty) onChangeRef.current(null);
    }, [shown, value, allowEmpty]);

    // Scroll the selected item into view when it changes
    useEffect(() => {
      const el = listRef.current && listRef.current.querySelector('[aria-selected="true"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }, [value]);

    // Keys handled here must not reach the CMS: Esc is its "cancel editing" shortcut, which would leave
    // the entry editor (and drop whatever was typed) when the user only meant to close this dialog.
    // Enter on a button or a list item is that control's own click, so it is left alone there.
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (!onCancelRef.current) return; // nothing to close (the wizard): leave the key to the CMS
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
      const onControl = event.target && event.target.closest && event.target.closest('button, [role="option"], a');
      if (event.key === 'Enter' && onControl) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const index = shown.findIndex((t) => t.id === value);
        const base = index === -1 ? 0 : index;
        const next = event.key === 'ArrowDown' ? Math.min(shown.length - 1, base + 1) : Math.max(0, base - 1);
        if (shown[next]) onChangeRef.current(shown[next].id);
      } else if (onConfirmRef.current && current) {
        onConfirmRef.current(current);
      }
    };

    return html`
      <div class="tsx-picker" onKeyDown=${onKeyDown}>
        <div class="tsx-picker-search">
          <input
            class="tsx-search"
            type="search"
            placeholder="搜索模板：名称、说明或正文里的词，可以输入多个词"
            aria-label="搜索模板"
            value=${query}
            onChange=${(event) => setQuery(event.target.value)}
          />
          <span class="tsx-count">找到 ${shown.length} 个</span>
        </div>
        <div class="tsx-picker-body">
          <div class="tsx-cats" role="group" aria-label="模板分类">
            ${appliesTo &&
              html`
                <button type="button" class="tsx-cat tsx-cat-applicable" aria-pressed=${category === 'applicable'} onClick=${() => setCategory('applicable')}>
                  <span>适用</span><span>${counts.applicable}</span>
                </button>
              `}
            <button type="button" class="tsx-cat" aria-pressed=${category === 'all'} onClick=${() => setCategory('all')}>
              <span>全部</span><span>${counts.all}</span>
            </button>
            ${catalog.categories.map(
              (c) => html`
                <button key=${c.value} type="button" class="tsx-cat" aria-pressed=${category === c.value} onClick=${() => setCategory(c.value)}>
                  <span>${c.label}</span><span>${counts[c.value] || 0}</span>
                </button>
              `,
            )}
          </div>
          <div class="tsx-list" role="listbox" aria-label="模板列表" ref=${listRef}>
            ${shown.length === 0 &&
              html`<div class="tsx-empty">没有匹配「${query.trim()}」的模板。<br />换个词试试，或者点左边的「全部」。</div>`}
            ${shown.map((t) => html`
              <button
                key=${t.id}
                type="button"
                role="option"
                class="tsx-item"
                aria-selected=${t.id === value}
                onClick=${() => onChange(t.id)}
                onDoubleClick=${() => onConfirm && onConfirm(t)}
              >
                <span class="tsx-item-title">${t.title}<span class="tsx-item-badge">${categoryLabel(catalog, t.category)}</span></span>
                <span class="tsx-item-desc">${t.description}</span>
              </button>
            `)}
          </div>
          <div class="tsx-main">
            ${current
              ? html`
                <div class="tsx-main-head">
                  <h3>${current.title}</h3>
                  <p>${current.description}</p>
                </div>
                <${Preview} markdown=${current.body} />
              `
              : html`<div class="tsx-empty">${
                allowEmpty && value === null
                  ? '已选择不套用模板：编辑页的正文是空白的。想套用的话，点左边列表里的一个模板。'
                  : '这里显示选中模板的说明和正文预览。'
              }</div>`}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Full-screen dialog wrapping the picker. `warning` (if any) is shown next to the buttons.
   * It's rendered in place with position: fixed rather than through a React portal: CMS.React is React
   * itself, without react-dom's createPortal. That works because nothing between the field and the
   * entry editor (position: fixed, z-index: 100) establishes a containing block for fixed elements.
   */
  function PickerDialog({ title, catalog, confirmLabel, warning, onConfirm, onCancel, initialCategory, appliesTo = null }) {
    const [value, setValue] = useState(null);
    const current = value ? { id: value, ...catalog.templates[value] } : null;
    // With a collection type, the dialog opens on the templates that apply to it; the user can still
    // switch to "all" or a category in the left column.
    const startCategory = initialCategory || (appliesTo ? 'applicable' : 'all');
    // Esc closes this dialog and nothing else: while it is open, the gate installed by installEscGate()
    // takes the key before the CMS can treat it as "cancel editing"
    const cancelRef = useRef(onCancel);
    cancelRef.current = onCancel;
    useEffect(() => {
      setEscCatcher(() => cancelRef.current());
      return () => setEscCatcher(null);
    }, []);
    return html`
      <div
        class="tsx-overlay"
        onMouseDown=${(event) => {
          if (event.target === event.currentTarget) onCancel();
        }}
      >
        <div class="tsx-dialog" role="dialog" aria-modal="true" aria-label=${title}>
          <div class="tsx-dialog-head">
            <h2>${title}</h2>
            <span class="tsx-spacer"></span>
            <button type="button" class="tsx-icon-btn" aria-label="关闭" title="关闭（Esc）" onClick=${onCancel}>✕</button>
          </div>
          <${TemplatePicker}
            catalog=${catalog}
            value=${value}
            onChange=${setValue}
            onConfirm=${onConfirm}
            onCancel=${onCancel}
            initialCategory=${startCategory}
            appliesTo=${appliesTo}
          />
          <div class="tsx-dialog-foot">
            ${warning && html`<span class="tsx-warn">${warning}</span>`}
            <span class="tsx-spacer"></span>
            <button type="button" class="tsx-btn" onClick=${onCancel}>取消</button>
            <button type="button" class="tsx-btn tsx-btn-primary" disabled=${!current} onClick=${() => onConfirm(current)}>
              ${confirmLabel}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ---------- Esc 的拦截闸 ----------
  // Esc 是 CMS 的「取消编辑」快捷键：在新建页里按一下，整个编辑页就退出了。小窗开着的时候按 Esc
  // 只应该关掉小窗，所以必须赶在 CMS 之前截住它。CMS 把这个快捷键监听在 window 的捕获阶段，同一
  // 位置按注册顺序执行，所以这里要在 CMS.init() 之前调用 installEscGate()，才能排在它前面。
  let escCatcher = null;

  function installEscGate() {
    if (window.__cmsUiEscGate) return;
    window.__cmsUiEscGate = true;
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || !escCatcher) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        escCatcher();
      },
      true,
    );
  }

  /** While `handler` is set, Esc is swallowed by the page and calls `handler` instead of reaching the CMS. */
  function setEscCatcher(handler) {
    escCatcher = handler;
  }

  // ---------- 往原生富文本编辑器里写正文 ----------
  // Sveltia 不允许自定义控件复用内置的 markdown 编辑器（CMS.getFieldType('markdown') 是 undefined），
  // 所以正文保持原生的 markdown 字段不动，这里从外面驱动它：切到「以 Markdown 编辑」的原文模式，
  // 把文本写进文本框，再切回富文本模式 —— 和手动操作走同一条路，由 CMS 自己解析 Markdown。
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor(probe, { timeout = 6000, step = 50, message = '等待超时' } = {}) {
    const start = Date.now();
    for (;;) {
      const value = probe();
      if (value) return value;
      if (Date.now() - start > timeout) throw new Error(message);
      await sleep(step);
    }
  }

  const BODY_FIELD_SELECTOR = '[data-field-type="markdown"][data-key-path="body"]';

  function findModeButton(field) {
    // The only toolbar button with the `markdown` icon; its icon name does not depend on the UI language
    return [...field.querySelectorAll('[role="toolbar"] button')].find(
      (button) => (button.querySelector('.material-symbols-outlined') || {}).textContent?.trim() === 'markdown',
    );
  }

  const isVisible = (el) => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const isRawMode = (field) => findModeButton(field)?.getAttribute('aria-pressed') === 'true';
  const visibleTextarea = (field) => [...field.querySelectorAll('textarea')].find(isVisible);
  const visibleRichRoot = (field) => [...field.querySelectorAll('.lexical-root')].find(isVisible);

  /** The first run of "real" text in a Markdown string: a fragment of letters, digits or CJK, 4+ in a row. */
  function firstTextOf(markdown) {
    const match = /[\p{Script=Han}A-Za-z0-9]{4,}/u.exec(String(markdown).replace(/^\s*(?:[#>*|-]|\d+\.)\s*/gm, ''));
    return match ? match[0] : null;
  }

  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  /** Lexical's own select-all command, triggered through a synthetic keydown on the editor. */
  function selectAllIn(rich) {
    rich.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true, [IS_MAC ? 'metaKey' : 'ctrlKey']: true }),
    );
  }

  /**
   * Insert Markdown through the editor's own "paste without formatting" path, which parses the text as
   * Markdown (headings, lists, tables, …) and replaces the selection. The editor is the rich text one
   * the whole time, so nothing flickers. Synthetic Ctrl/Cmd+Shift+V opens that path for one second;
   * the paste event has to arrive inside the window.
   */
  function pasteMarkdown(rich, markdown) {
    rich.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'v',
        code: 'KeyV',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
        [IS_MAC ? 'metaKey' : 'ctrlKey']: true,
      }),
    );
    const data = new DataTransfer();
    data.setData('text/plain', markdown);
    rich.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  }

  /** Resolve to the rich text element once its text has stopped changing, or to null after `timeout` ms. */
  async function settledRichText(field, { timeout = 4000 } = {}) {
    let last = -1;
    let stable = 0;
    const start = Date.now();
    for (;;) {
      await sleep(60);
      const rich = visibleRichRoot(field);
      const length = rich ? rich.innerText.length : -1;
      if (length === last) stable += 1;
      else {
        stable = 0;
        last = length;
      }
      if (rich && stable >= 4) return rich;
      if (Date.now() - start > timeout) return rich || null;
    }
  }

  /** The first, preferred way: no mode switch. Throws if the text does not show up. */
  async function setBodyMarkdownByPaste(markdown) {
    const field = document.querySelector(BODY_FIELD_SELECTOR);
    if (!field) throw new Error('找不到正文的编辑框。');
    const rich = visibleRichRoot(field);
    if (!rich) throw new Error('找不到富文本编辑框。');
    if (document.activeElement && field.contains(document.activeElement)) document.activeElement.blur();
    rich.focus();
    selectAllIn(rich);
    await sleep(80);
    pasteMarkdown(rich, markdown);
    const after = await settledRichText(field);
    if (!after || after.innerText.trim() === '') throw new Error('粘贴后正文仍然是空的');
    const anchor = firstTextOf(markdown);
    if (anchor && !after.innerText.includes(anchor)) throw new Error('粘贴后正文里没有找到模板的文字');
    if (after.scrollIntoView) after.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /** The fallback: switch the editor to raw Markdown, write the text box, switch back. The editor flickers once. */
  async function setBodyMarkdownBySwitching(markdown) {
    const field = document.querySelector(BODY_FIELD_SELECTOR);
    if (!field) throw new Error('找不到正文的编辑框。请打开词条的编辑页面后再试。');
    const toggle = findModeButton(field);
    if (!toggle) throw new Error('找不到正文编辑器里「以 Markdown 编辑」的切换按钮。');
    if (isRawMode(field)) {
      visibleTextarea(field)?.focus();
    } else {
      // A focused editor would restore its caret and selection, so blur it before switching
      if (field.contains(document.activeElement)) document.activeElement.blur();
      toggle.click();
    }
    const textarea = await waitFor(() => visibleTextarea(field), { message: '正文编辑器没有切换到 Markdown 原文模式。' });
    textarea.focus();
    textarea.value = markdown;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    // Give the editor a moment to take the new value before switching back
    await sleep(600);
    if (!markdown.trim()) return;
    toggle.click();
    const rich = await waitFor(
      () => isVisible(visibleRichRoot(field)) && visibleRichRoot(field).innerText.trim() !== '' && visibleRichRoot(field),
      { message: '正文编辑器没有切回富文本模式，或者没有显示模板内容。' },
    );
    // Let the user see where the content went
    if (rich.scrollIntoView) rich.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /**
   * Replace the body of the entry editor with `markdown`. Resolves once the rich text editor shows it.
   * In the CMS's raw Markdown mode the text box is written directly and the mode is left alone.
   */
  async function setBodyMarkdown(markdown) {
    const field = document.querySelector(BODY_FIELD_SELECTOR);
    if (field && isRawMode(field)) {
      const textarea = visibleTextarea(field);
      if (textarea) {
        textarea.focus();
        textarea.value = markdown;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }
    try {
      await setBodyMarkdownByPaste(markdown);
    } catch (error) {
      console.warn('[cms-ui] 粘贴的方式没有生效，退回到切换编辑模式的方式', error);
      await setBodyMarkdownBySwitching(markdown);
    }
  }

  // ---------- 右侧侧栏的「别名」面板 ----------
  // 图标名跟界面语言无关：面板开关的图标是 anchor，铅笔是 edit。表单里别的按钮也用 edit 图标
  // （「所属 mod」字段的「编辑 Mod」等），铅笔是唯一不在任何字段里的那一个。
  const iconOf = (el) => (el && el.querySelector('.material-symbols-outlined') ? el.querySelector('.material-symbols-outlined').textContent.trim() : null);
  const outsideFields = (el) => !el.closest('section[data-key-path], .tsx-root');
  const aliasPencil = () =>
    [...document.querySelectorAll('button')].find(
      (button) => isVisible(button) && iconOf(button) === 'edit' && outsideFields(button),
    );
  /** The slug panel's text box while it is in edit mode. It is the only visible text input outside the form fields. */
  const aliasTextBox = () =>
    [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden])')].find(
      (input) => isVisible(input) && outsideFields(input),
    );
  // 标题为空时，面板里代替别名显示的是一个 12 位的十六进制随机 ID（0.271.0 实测，如 2fe50f5f734d）。
  const RANDOM_ID = /^[0-9a-f]{12}$/;

  /**
   * Open the sidebar's Slug panel and put its text box in edit mode, ready for typing.
   * Resolves to true, or to false when neither the panel nor the pencil can be found.
   *
   * `clearPlaceholder` (the caller passes it while the title is still empty): the random id that the
   * panel shows in place of an empty slug is only a placeholder. It gives way to the title's slug as
   * soon as a title is typed — unless edit mode is confirmed with "Done", which turns it into the real
   * file name. With this flag the text box is emptied instead, so that confirming changes nothing.
   */
  async function openAliasEditor({ clearPlaceholder = false } = {}) {
    const anchor = [...document.querySelectorAll('[role="radiogroup"] [role="radio"]')].find((radio) => iconOf(radio) === 'anchor');
    if (!anchor) return false;
    if (anchor.getAttribute('aria-checked') !== 'true') anchor.click();
    // The pencil shows when the panel is not in edit mode; the text box, when it already is
    let target = null;
    const start = Date.now();
    while (!(target = aliasPencil() || aliasTextBox())) {
      if (Date.now() - start > 3000) return false;
      await sleep(60);
    }
    if (target.tagName !== 'INPUT') target.click();
    await sleep(250);
    const box = aliasTextBox();
    if (box) {
      box.focus();
      if (clearPlaceholder && RANDOM_ID.test(box.value)) {
        // React tracks the value through its own property, so set it through the prototype's setter
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, '');
        box.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    return true;
  }

  // ---------- 物品清单（items-by-mod.json，构建生成）----------
  // { mods: [{ id, name, items: [{ id, name, taken }] }] }

  /** 属于某个 mod 的物品，按名称排序；mod 没选、或者清单里没有这个 mod 时是空数组。 */
  function pickModItems(catalog, modId) {
    const mod = (catalog?.mods ?? []).find((m) => m.id === modId);
    return [...(mod?.items ?? [])].sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id), 'zh-Hans-CN'));
  }

  /** 按名称或 ID 搜索：不分大小写，空格分开的每个词都要出现。顺序不变。 */
  function searchItems(items, query) {
    const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((item) => {
      const text = `${item.name ?? ''} ${item.id}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }

  return {
    ensureStyle,
    installEscGate,
    setEscCatcher,
    loadCatalog,
    categoryLabel,
    searchTemplates,
    Preview,
    TemplatePicker,
    PickerDialog,
    setBodyMarkdown,
    openAliasEditor,
    BODY_FIELD_SELECTOR,
    sleep,
    waitFor,
    pickModItems,
    searchItems,
  };
})();
