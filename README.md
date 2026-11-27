# Probably Stolen 模组百科

Probably Stolen 模组的非官方百科，由贡献者在线维护。

物品的名称、描述、价格、贴图等基础数据，是用工具从模组的安装文件里提取出来的，与游戏内的表现一致；机制和玩法指南由贡献者编写，每条数值都注明来源。

- 网站：<https://probably-documented.github.io/probably-stolen-mod-wiki/>
- 离线包：在 [Releases 页](https://github.com/probably-documented/probably-stolen-mod-wiki/releases)下载
- 在线编辑：<https://probably-documented.github.io/probably-stolen-mod-wiki/admin/>

## 给读者

- **找 mod**：从主页出发，按分区找；或者用主页的搜索，它能按名字、ID、简介找 mod，也认别名和关键词，还可以限定在某个分区里找。
- **看一个分区有什么**：进了分区页，标题下面有两个入口。「物品图鉴」列出这个分区所有 mod 的物品，可以按品类和来源筛选；「机制说明」按 mod 分组列出这个分区的机制页。
- **看一个 mod 有什么**：mod 自己的页面上有它的物品图鉴、机制说明和更新日志。
- **找单个物品或某一篇词条**：用顶栏的「物品检索器」。
- **离线包**：在 Releases 页下载，解压后双击 `index.html`。主页的搜索和分区物品图鉴的筛选在离线包里同样能用。

## 给贡献者

编辑入口是 `/admin/`，用 GitHub 账号登录。能做什么由维护者分配的角色决定（管理员、编辑、只读）。

### 能做什么

- 建 mod、分区、机制词条、物品词条，写不属于任何 mod 的站点页面。
- 上传图片，写 mod 的重定向（搜索用的别名和关键词）。
- 套用正文模板。

### 几条规矩

- **文件名**：用小写英文加短横线，例如 `barrel-system`；也接受中文。点「设置文件名」可以自己定。
- **物品词条的文件名就是「物品 ID」**：从那一栏的清单里选一件已导出的物品。数据里还没有的新物品也可以自己起一个 ID，这时必须填「标题」，它就是这件物品在站上的名字。
- **模板**：写机制页、物品词条、分区或 mod 的介绍时，正文上方有「从模板开始」按钮，选一个模板，内容会直接进编辑框，再按实际情况修改。模板在 [`templates/`](templates) 里，要增删改请提 Pull Request。
- **机制词条和物品词条都属于某个 mod**：新建时先选「所属 mod」。「所属 mod」保存后不要再改，文件不会跟着移动，网站会因此停止更新；确实要换，新建一篇，把内容搬过去。
- **分区页可以更丰富**：打开「把 Mod 显示成卡片」，分区页上的 mod 就显示成一张张卡片，带版本、简介和物品数，都是自动的；「物品图鉴页的概述」「机制说明页的概述」会分别显示在分区物品图鉴页和机制说明页的最上面；介绍正文显示在分区块后面。按功能分类的分区不用开卡片，保持简单就好。
- **图片**：支持 png、jpg、gif、webp，不支持 SVG。图片请单独占一行，不要贴在表格的行尾。

### 什么情况下网站不会更新

保存之后网站会自动重新构建。内容有问题时构建会停下，这次改动不上线，直到改好为止；说明在仓库的 Actions 页面里，是中文的，会指出是哪个文件、哪里不对、怎么改。常见的情况有：

- 两篇物品词条写的是同一件物品。
- 正文里链接到一个不存在的页面。
- 上传了 SVG。
- 正文里嵌了脚本。
- 表格的某一格比表头宽，多半是图片贴在了行尾。
- 两个站点页面都填了「顶部导航上的名字」。

## 给开发者

零 npm 依赖，只用 Node 内置模块。

### 目录

| 路径 | 是什么 |
|---|---|
| [`content/`](content) | 贡献者写的内容：`home.md`（主页）、`sections/`（分区）、`mods/<Mod ID>/`（`_index.md` 导航页；也兼容 `main/index.md`、`mechanics/`、`items/`、`redirects.yaml`、`images/`）、`site/`（不属于任何 mod 的页面） |
| [`data/`](data) | 提取出来的物品数据，只读；由另一个仓库 `modwiki` 导出 |
| [`assets-src/`](assets-src) | 样式、脚本、BWIKI 素材；`mods/` 下是物品贴图的镜像，同样是导出的 |
| [`templates/`](templates) | 正文模板，只读 |
| [`admin/`](admin) | 在线编辑器的壳；[`config.yml`](admin/config.yml) 是它的全部配置 |
| [`tools/build/`](tools/build) | 渲染与检查 |
| [`tools/cms/`](tools/cms) | 编辑器的三个自定义控件：「从模板开始」「设置文件名」「物品 ID」 |
| [`tools/extract/frontmatter.js`](tools/extract/frontmatter.js) | 读文件开头的元数据 |
| [`tools/pack.js`](tools/pack.js)、[`tools/release-policy.js`](tools/release-policy.js)、[`tools/compare-dist.js`](tools/compare-dist.js) | 离线包打包、发布规则、两份构建的逐字节对比 |
| [`tests/`](tests) | 测试（`node:test`） |
| [`.github/workflows/`](.github/workflows) | `deploy.yml` 和 `release-offline.yml` |

### 命令

- `npm test`：全部测试，不需要游戏目录。
- `npm run build`：构建到 `dist/`。内容有问题时构建失败，退出码是 1，报告是中文的。
- `npm run pack`：本地打离线包到仓库根目录；`npm run pack -- <路径>` 指定文件名。不含 `admin/`。
- `node tools/compare-dist.js <A> <B>`：逐字节比较两份构建，用来证明「不该变的页一个字节都没变」。`--ignore <前缀>` 不比，`--allow <正则>` 照报但不计入退出码。

### 数据从哪来

`data/` 和 `assets-src/mods/` 不在这个仓库里生成。它们由 `modwiki` 仓库从游戏的 Mods 目录提取后导出，那一步需要游戏目录；在这里它们只读。

### 构建检查

贡献者能触发的构建失败都是中文报告，最后一行是提示，指出改哪个文件。检查分两处：[`tools/build/content-lint.js`](tools/build/content-lint.js) 管内容本身（词条放对目录没有、文件名、文件开头的元数据）；[`tools/build/skeleton-build.js`](tools/build/skeleton-build.js) 是构建入口，在渲染之后查指向不存在文件的链接、危险写法（[`tools/build/audit.js`](tools/build/audit.js)：可执行脚本、`on*` 属性、外部资源）、比表头宽的表格行，以及「顶部导航上的名字」的冲突。

每个分区另有两页是构建自动生成的，没有对应的文件：`sections/<分区>/items.html`（物品图鉴）和 `sections/<分区>/mechanics.html`（机制说明）。

### 工作流

- `deploy.yml`：推送到 `main` 就跑测试、构建站点、发布到 GitHub Pages。
- `release-offline.yml`：离线包。两个包之间至少隔 3 天、有更新才发，发到 GitHub Releases；规则只有一处，在 [`tools/release-policy.js`](tools/release-policy.js)。

## 署名

页面风格与素材复用自[深空当铺 BWIKI](https://wiki.biligame.com/probablystolen)，遵循 CC BY-NC-SA 4.0。
