// CMS 的自定义字段控件（浏览器端）。构建把它接在 tools/cms/lib.js 的后面，写成 dist/admin/admin.js，
// 由 admin/index.html 以普通脚本加载；那里设了 CMS_MANUAL_INIT，所以 CMS.init() 由这里调用。
//
// 三个控件：
//   template-starter  「从模板开始」：装在正文字段的标题行上。点开小窗选模板，内容立刻进富文本编辑器
//   filename-hint     「设置文件名」：把人引到 CMS 自带的「别名」面板。文件名只有别名这一个来源，
//                     不会出现「字段里的值和真实文件名对不上」
//   item-id           「物品 ID」：物品词条的文件名就是它（集合级 slug 模板 {{fields.item_id}}）。
//                     可以从本 mod 已导出的物品里选，也可以手填
//
// 两个辅助键（template_starter、filename_hint）不保存任何值，保存前从条目数据里去掉。
(() => {
  const { useState, useEffect, useRef, useMemo } = CMS.React;
  const L = window.CmsUi;
  L.ensureStyle();

  const catalogPromise = L.loadCatalog();
  catalogPromise.catch((error) => console.error('[cms-ui] 模板列表加载失败', error));

  // ---------- 「从模板开始」：装到正文字段的标题行上 ----------
  function TemplateStarter({ field, forID, entry }) {
    // 当前是哪个集合（mechanics / items / …），写在字段配置的 applies_to 上
    const appliesTo = field && typeof field.get === 'function' ? field.get('applies_to') : null;
    const [catalog, setCatalog] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [applied, setApplied] = useState(null);
    // 正文已有内容时，使用按钮要点两次才覆盖
    const [armed, setArmed] = useState(false);

    useEffect(() => {
      catalogPromise.then(setCatalog, (e) => setLoadError(e.message));
    }, []);

    const body = entry && typeof entry.getIn === 'function' ? entry.getIn(['data', 'body']) : null;
    const hasBody = typeof body === 'string' && body.trim() !== '';

    const openRef = useRef(() => {});
    openRef.current = () => setOpen(true);
    // The bar is plain DOM that React doesn't own (it lives in another field's header), so it's painted
    // from the latest state through a ref.
    const stateRef = useRef({});
    stateRef.current = { busy, loadError, error, applied, hasBody };
    const barRef = useRef(null);

    const paint = () => {
      const bar = barRef.current;
      if (!bar) return;
      const s = stateRef.current;
      const [button, note] = bar.children;
      button.textContent = s.busy ? '正在写入…' : '从模板开始';
      button.disabled = s.busy || !!s.loadError;
      const tone = s.error ? 'is-error' : s.applied ? 'is-ok' : s.hasBody ? 'is-warn' : '';
      note.className = `tsx-starter-note${tone ? ` ${tone}` : ''}`;
      note.textContent = s.error
        ? s.error
        : s.loadError
          ? s.loadError
          : s.applied
            ? `已套用「${s.applied}」。可以直接在下面的编辑框里修改，改完点右上角的「保存」。`
            : s.hasBody
              ? '正文已有内容：再用模板会把它全部覆盖。'
              : '正文是空的。选一个模板，内容会出现在下面的编辑框里。';
    };

    useEffect(() => {
      paint();
    });

    useEffect(() => {
      let cancelled = false;
      let bar = null;
      (async () => {
        let header = null;
        try {
          // The body field is rendered after this one, so its header may not exist yet
          header = await L.waitFor(() => document.querySelector(`${L.BODY_FIELD_SELECTOR} > header`), { timeout: 8000 });
        } catch (error) {
          console.error('[cms-ui] 没找到正文字段的标题行，模板按钮没有显示', error);
          return;
        }
        if (cancelled) return;
        bar = document.createElement('span');
        bar.className = 'tsx-starter-bar';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tsx-starter-btn';
        button.id = forID;
        button.addEventListener('click', () => openRef.current());
        const note = document.createElement('span');
        note.className = 'tsx-starter-note';
        bar.append(button, note);
        barRef.current = bar;
        header.insertBefore(bar, header.querySelector('.spacer') || header.lastChild);
        paint();
      })();
      return () => {
        cancelled = true;
        if (bar) bar.remove();
        barRef.current = null;
      };
    }, []);

    const apply = async (template) => {
      setBusy(true);
      setError(null);
      try {
        await L.setBodyMarkdown(template.body);
        setOpen(false);
        setApplied(template.title);
      } catch (e) {
        setError(`模板没有写进正文：${e.message}`);
      }
      setBusy(false);
    };

    const confirm = (template) => {
      if (hasBody && !armed) {
        setArmed(true);
        return;
      }
      apply(template);
    };

    const close = () => {
      setOpen(false);
      setArmed(false);
    };

    // Only the dialog is React-rendered. It's position: fixed, so it shows even though the field
    // itself takes no space.
    return html`
      <div class="tsx-root">
        ${open
          && catalog
          && html`
            <${L.PickerDialog}
              title="从模板开始"
              catalog=${catalog}
              appliesTo=${appliesTo}
              confirmLabel=${hasBody ? (armed ? '再点一次，确认覆盖现有正文' : '覆盖正文，使用这个模板') : '使用这个模板'}
              warning=${hasBody ? '正文里已经有内容，使用模板会把它全部替换。' : null}
              onConfirm=${confirm}
              onCancel=${close}
            />
          `}
      </div>
    `;
  }

  // ---------- 「设置文件名」：把人引到右侧的「别名」面板 ----------
  // 控件拿到的 props 里没有集合配置，只有 entry（Immutable Record）：collection 是集合名，path 在新建页
  // 是空串、在已保存的条目上是文件路径。newRecord 不能用（新建页上也是 false），所以看 path。
  const collectionOf = (entry) => (entry && typeof entry.get === 'function' ? entry.get('collection') : null);
  const isSaved = (entry) => {
    const file = entry && typeof entry.get === 'function' ? entry.get('path') : null;
    return typeof file === 'string' && file !== '';
  };

  // 实测（Test 后端）：在「别名」面板里改一个已保存的 Mod 的文件夹名，只有 _index.md 和 images/ 会移到新
  // 目录；它下面的 mechanics/ 和 redirects.yaml 留在旧目录里（里面的 mod: 字段却会被改成新名字），
  // 词条随后从列表里消失，图片引用也断了。把名字改回去就全部复原。所以编辑页不把人往那儿引。
  const MOD_LOCKED_NOTE =
    '注意：Mod 的目录名建立后不要改。在右侧「别名」面板里改了它，只有 Mod 页和图片会移到新目录，它下面的词条和重定向文件会留在旧目录里，并从列表里消失。万一改了，把名字改回去就能复原。';
  // 实测：在词条页点「添加 Mod」弹出的对话框里没有「别名」面板，所以在这里新建的 Mod 只能按标题生成
  // 目录名（中文标题会得到中文目录名）。要英文的 Mod ID，只能从左侧「Mod」→「新建」进去。
  const NESTED_NOTE =
    '在这里不能指定目录名：新建的 Mod 只能按标题自动生成目录名（中文标题会得到中文目录名）。Mod ID 需要是英文的话，请先点「取消」，到左侧「Mod」→「新建」里建好，再回来选它。';

  function FilenameHint({ forID, entry }) {
    const [status, setStatus] = useState(null);
    // 两种情况不显示「设置文件名」按钮：
    //  1. 已保存的 Mod：见 MOD_LOCKED_NOTE。
    //  2. 嵌套的编辑对话框（比如在词条页点「编辑 Mod」或「新建 Mod」）：那里点按钮打开的是外层条目的
    //     别名面板，会误导人。宿主元素由回调 ref 在挂载时同步给出，所以对话框里的那一项从第一帧起就没有按钮。
    const [host, setHost] = useState(null);
    const inDialog = !!(host && host.closest('[role="dialog"]'));
    const savedMod = collectionOf(entry) === 'mods' && isSaved(entry);
    // 标题还没填的时候，「别名」面板里代替别名显示的是一个随机占位值：进了编辑态先把它清掉，
    // 否则什么都不改就点「完成」，保存出来的文件名就是那串随机字符
    const title = entry && typeof entry.getIn === 'function' ? entry.getIn(['data', 'title']) : null;
    const titleEmpty = typeof title !== 'string' || title.trim() === '';
    const click = async () => {
      setStatus(null);
      const ok = await L.openAliasEditor({ clearPlaceholder: titleEmpty });
      if (!ok) setStatus('没有打开「别名」面板。请先填标题，再点右侧竖条里的锚形图标「别名」，在里面点铅笔。');
    };
    const note = savedMod ? MOD_LOCKED_NOTE : inDialog ? NESTED_NOTE : null;
    return html`
      <div class="tsx-root tsx-filename" ref=${setHost}>
        ${
          note
            ? html`<span class=${savedMod ? 'tsx-note tsx-note-warn' : 'tsx-note'}>${note}</span>`
            : html`
              <span class="tsx-note">
                不填就由标题自动生成（中文标题会得到中文文件名）。规范要求用小写英文加短横线，例如
                <code>barrel-system</code>；也接受中文。
              </span>
              <div class="tsx-row">
                <button type="button" id=${forID} class="tsx-btn" onClick=${click}>设置文件名</button>
                ${status && html`<span class="tsx-error" role="alert">${status}</span>`}
              </div>
            `
        }
      </div>
    `;
  }

  // ---------- 「物品 ID」：物品词条的文件名 ----------
  // 清单由构建生成（dist/admin/items-by-mod.json）：每个 mod 已导出的物品，和哪些已经有词条。
  let itemCatalogPromise = null;
  function loadItemCatalog() {
    if (!itemCatalogPromise) {
      itemCatalogPromise = fetch('./items-by-mod.json')
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .catch((error) => {
          // 下次再试：清单没取到不该把这一栏永久锁死
          itemCatalogPromise = null;
          throw error;
        });
    }
    return itemCatalogPromise;
  }

  // 样式接在共享库的后面。变量（--tx-*）定义在 .tsx-root 上，所以控件和小窗都包在它里面。
  const ITEM_ID_STYLE_ID = 'cms-ui-item-id-style';
  function ensureItemIdStyle() {
    if (document.getElementById(ITEM_ID_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = ITEM_ID_STYLE_ID;
    style.textContent = `
.cui-item-dialog { width: min(560px, 100%); height: min(600px, 100%); }
.cui-item-list { list-style: none; margin: 0; padding: 8px; flex: 1; min-height: 0; overflow: auto; }
.cui-item-list .tsx-item:disabled { cursor: not-allowed; opacity: .5; }
`;
    document.head.appendChild(style);
  }

  function ItemId({ forID, value, onChange, entry, field }) {
    const [catalog, setCatalog] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    // 当前条目的「所属 mod」决定列出哪些物品
    const mod = entry && typeof entry.getIn === 'function' ? entry.getIn(['data', 'mod']) : null;
    // The CMS hands a custom control no <label for>: the box is named after the field itself.
    const label = field && typeof field.get === 'function' ? field.get('label') : null;

    useEffect(() => {
      loadItemCatalog().then(setCatalog, (error) => setLoadError(`物品清单没有加载出来：${error.message}`));
    }, []);

    const items = useMemo(() => L.pickModItems(catalog, mod), [catalog, mod]);
    const shown = useMemo(() => L.searchItems(items, query), [items, query]);
    const current = items.find((item) => item.id === value);
    // 清单里标着「已有词条」的物品，对一篇已经保存的词条来说就是它自己，不说「会重名」。
    const status = L.itemStatus(current, { saved: isSaved(entry) });

    // 小窗开着的时候按 Esc 只关小窗，不退出编辑页
    const closeRef = useRef(() => {});
    closeRef.current = () => setOpen(false);
    useEffect(() => {
      if (!open) return undefined;
      L.setEscCatcher(() => closeRef.current());
      return () => L.setEscCatcher(null);
    }, [open]);

    return html`
      <div class="tsx-root tsx-filename">
        <span class="tsx-note">
          这一篇的文件名就是物品 ID，保存后不要再改。有导出数据的物品，ID 必须和它一致，这一篇才会接上那件物品。
        </span>
        <div class="tsx-row">
          <input id=${forID} class="tsx-text" type="text" aria-label=${label} value=${value ?? ''} spellcheck="false" autocomplete="off"
            onChange=${(event) => onChange(event.target.value)} />
          <button type="button" class="tsx-btn" disabled=${!mod} onClick=${() => { setQuery(''); setOpen(true); }}>
            从本 mod 已导出的物品里选
          </button>
        </div>
        ${!mod && html`<span class="tsx-note">先选「所属 mod」，才能列出它的物品。</span>`}
        ${loadError && html`<span class="tsx-error" role="alert">${loadError}</span>`}
        ${status && html`<span class=${status.warn ? 'tsx-warn' : 'tsx-note'}>${status.text}</span>`}
        ${
          open && html`
            <div class="tsx-overlay" onMouseDown=${(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
              <div class="tsx-dialog cui-item-dialog" role="dialog" aria-modal="true" aria-label="选择物品">
                <div class="tsx-dialog-head">
                  <h2>选择物品</h2>
                  <span class="tsx-spacer"></span>
                  <button type="button" class="tsx-icon-btn" aria-label="关闭" title="关闭（Esc）" onClick=${() => setOpen(false)}>✕</button>
                </div>
                <div class="tsx-picker-search">
                  <input class="tsx-search" type="search" placeholder="搜索物品名称或 ID" aria-label="搜索物品"
                    value=${query} onChange=${(event) => setQuery(event.target.value)} />
                  <span class="tsx-count">${items.length} 件</span>
                </div>
                ${
                  shown.length === 0
                    ? html`<div class="tsx-empty">${
                      items.length === 0
                        ? '这个 mod 还没有导出物品数据。关掉这个小窗，手填物品 ID。'
                        : `没有匹配「${query.trim()}」的物品。`
                    }</div>`
                    : html`<ul class="cui-item-list">
                        ${shown.map((item) => html`
                          <li>
                            <button type="button" class="tsx-item" disabled=${item.taken}
                              title=${item.taken ? '这件物品已经有词条了' : item.id}
                              onClick=${() => { onChange(item.id); setOpen(false); }}>
                              <span class="tsx-item-title">${item.name ?? item.id}<span class="tsx-item-badge">${item.id}</span></span>
                            </button>
                          </li>`)}
                      </ul>`
                }
                <div class="tsx-dialog-foot">
                  <span class="tsx-spacer"></span>
                  <button type="button" class="tsx-btn" onClick=${() => setOpen(false)}>取消</button>
                </div>
              </div>
            </div>
          `
        }
      </div>
    `;
  }

  // 「物品 ID」的样式:必须在 CMS.init() 之前注入,也要在它用的常量声明之后
  ensureItemIdStyle();

  // 必须在 CMS.init() 之前：CMS 的「取消编辑」快捷键也监听在 window 的捕获阶段，先注册的先执行
  L.installEscGate();

  CMS.registerFieldType('template-starter', TemplateStarter, undefined, {
    properties: { applies_to: { type: 'string' } },
  });
  CMS.registerFieldType('filename-hint', FilenameHint);
  CMS.registerFieldType('item-id', ItemId);

  // 两个辅助字段都不保存任何值；万一它们出现在条目数据里，保存前去掉，不写进文件。
  CMS.registerEventListener({
    name: 'preSave',
    handler: ({ entry }) => {
      const data = entry.get('data');
      let next = data;
      for (const key of ['template_starter', 'filename_hint']) {
        if (next.has(key)) next = next.delete(key);
      }
      return next === data ? undefined : next;
    },
  });

  CMS.init();
})();
