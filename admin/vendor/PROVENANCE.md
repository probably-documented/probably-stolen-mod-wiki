# Sveltia CMS 本体来源说明

本目录下的 7 个文件都是 Sveltia CMS 官方发布的构建产物,**原样入库**:没有加头注释、
没有格式化、没有转换行尾,在官方包里的相对路径也原样保留。7 个文件都是纯文本、LF 行尾。

| 入库文件(相对本目录) | 在 tarball 里的路径 | 大小 |
|---|---|---|
| `sveltia-cms.js` | `package/dist/sveltia-cms.js` | 2,669,038 字节 |
| `chunks/additions.js` | `package/dist/chunks/additions.js` | 100,842 字节 |
| `chunks/assets/_shared-module_0-C8f2zUat.js` | `package/dist/chunks/assets/_shared-module_0-C8f2zUat.js` | 113 字节 |
| `chunks/assets/_shared-module_46-Dfds8-Cf.js` | `package/dist/chunks/assets/_shared-module_46-Dfds8-Cf.js` | 270 字节 |
| `chunks/assets/_shared-module_64-Dh5oNTNO.js` | `package/dist/chunks/assets/_shared-module_64-Dh5oNTNO.js` | 206 字节 |
| `chunks/react-dom.js` | `package/dist/chunks/react-dom.js` | 213,176 字节 |
| `chunks/assets/rolldown-runtime-BWaJ3C7D.js` | `package/dist/chunks/assets/rolldown-runtime-BWaJ3C7D.js` | 911 字节 |

- `sveltia-cms.js` 是主脚本,由 `admin/index.html` 以 `<script src="./vendor/sveltia-cms.js">` 加载。
- 其中 4 个是登录要用的代码块:`chunks/additions.js` 和它静态导入的 3 个共享模块
  (`additions.js` 导入 `_shared-module_0`、`_46`、`_64`;`_0` 和 `_46` 再各自导入 `_64`)。
  后端是 GitHub 且 `auth_type: additions` 时——本站 `admin/config.yml` 正是这种配置——
  主脚本用 `import()` 加载 `chunks/additions.js`,地址是相对主脚本所在目录算出来的,
  所以这 4 个文件必须放在 `vendor/chunks/` 下并保持这个布局。
- 另外 2 个是 CMS 渲染自定义界面(自定义字段控件、自定义页面)时才加载的:`chunks/react-dom.js`
  和它静态导入的 `chunks/assets/rolldown-runtime-BWaJ3C7D.js`。同样是相对主脚本所在目录找,
  本地没有就回退到 UNPKG。2026-11-25 补入,缘由见下面「已知限制」一节。

构建时整个 `admin/` 目录被复制到 `dist/admin/`(在外链审计之后),不进离线 zip。

## 来源

| 项目 | 值 |
|---|---|
| 包名 | `@sveltia/cms` |
| 版本(固定) | `0.271.0` |
| npm tarball | `https://registry.npmjs.org/@sveltia/cms/-/cms-0.271.0.tgz` |
| tarball 大小 | 18,352,671 字节 |
| registry integrity(`dist.integrity`,sha512 / base64) | `sha512-hdkwEshQK4aZmijVi5aVuB2yvBir6wJ5nhbrCH5+Xm1ymvbuS9AU5inBPMVFdvtvK0YJd8qAsBegJDQqN7dHCw==` |
| tarball sha1(`dist.shasum`) | `81f63a928afe577eb68554a94fa3bee6e1735efb` |
| 获取日期 | 2026-11-23 |
| 许可证 | MIT(全文见文末) |

入库文件的 sha256,路径相对本目录:

```text
sha256(sveltia-cms.js) = `1039b653e9197f0117433933456abc707f55a36ab40ff81d828dbc20fdf16fd1`
sha256(chunks/additions.js) = `772f233c7002d6ea4a7d59dbffe793399c3057e95c0e433ad51b2e0e8b545f7f`
sha256(chunks/assets/_shared-module_0-C8f2zUat.js) = `e31ad2f79818bb5a887f9231dc110b68d263da1b4d2ac00001f465a20ec63cfe`
sha256(chunks/assets/_shared-module_46-Dfds8-Cf.js) = `1c5ac202f0dca675031f09a700cacbbab226e2581a8287359260f5bae8647f04`
sha256(chunks/assets/_shared-module_64-Dh5oNTNO.js) = `58369044fbbd46f9561e7d1e6f0612eec899fce0748393ca4aa0ef3d52d85340`
sha256(chunks/react-dom.js) = `55105ab1030a24f007904cbab670655ce1d948e8d5f1a237ebed1908871b44e9`
sha256(chunks/assets/rolldown-runtime-BWaJ3C7D.js) = `d0e9044430006c5bb48f477501a5af465f0a6377d2fcd7495aa215b8b75aaee3`
```

获取时用 Node 内置的 `crypto.createHash('sha512')` 对 tarball 求 base64 摘要,与 registry
实时返回的 `dist.integrity` 一致后才解包;前 5 个入库文件都与解包出的原文件用 `cmp` 逐字节比对一致。
后补的 2 个(2026-11-25)各取了两份互相核对:一份从同一个已验证的 tarball 里解出来,一份从
`https://unpkg.com/@sveltia/cms@0.271.0/dist/chunks/` 下载,逐字节相同。两个文件都是纯文本、LF 行尾。

## 怎样复核

`tests/admin-config.test.js`(`npm test`)每次都会检查三件事:本目录下除本页之外恰好是上面
7 个文件;上面的 sha256 行恰好也是这 7 个文件;每个文件的 sha256 与记录的一致。仓库根目录的
`.gitattributes` 把这些文件标为 `-text`(`admin/vendor/sveltia-cms.js` 和 `admin/vendor/chunks/**`),
所以任何平台检出时 git 都不会转换它们的行尾。

想和官方产物重新逐字节比对(在仓库根目录执行,需要联网):

```bash
curl -sO https://registry.npmjs.org/@sveltia/cms/-/cms-0.271.0.tgz
mkdir -p official
tar -xzf cms-0.271.0.tgz -C official \
  package/dist/sveltia-cms.js \
  package/dist/chunks/additions.js \
  package/dist/chunks/assets/_shared-module_0-C8f2zUat.js \
  package/dist/chunks/assets/_shared-module_46-Dfds8-Cf.js \
  package/dist/chunks/assets/_shared-module_64-Dh5oNTNO.js \
  package/dist/chunks/react-dom.js \
  package/dist/chunks/assets/rolldown-runtime-BWaJ3C7D.js
for f in sveltia-cms.js chunks/additions.js chunks/assets/_shared-module_0-C8f2zUat.js \
  chunks/assets/_shared-module_46-Dfds8-Cf.js chunks/assets/_shared-module_64-Dh5oNTNO.js \
  chunks/react-dom.js chunks/assets/rolldown-runtime-BWaJ3C7D.js; do
  cmp "official/package/dist/$f" "admin/vendor/$f" && echo "identical: $f"
done
```

升级版本时:改本页的版本号、integrity 和 7 行 sha256,并替换这 7 个文件(`rolldown-runtime`
的文件名里带哈希,多半会变)。新版本如果改动了
`additions.js` 导入的共享模块(文件名里带哈希,多半会变),本页的文件清单和
`tests/admin-config.test.js` 里的 `VENDORED` 清单要跟着改;`.gitattributes` 的规则覆盖整个
`chunks/` 目录,只要文件还在它下面就不用动。

## 已知限制:入库的文件并不是自包含的

入库的是官方的 **CDN 构建**——不需要打包器,但它是按需加载的:一部分代码和资源不在这些
文件里,运行时从网络上取。自托管并不能让 CMS 完全离线运行。

- **按需代码块(chunks)。** 主脚本用 `import()` 加载官方包里 `dist/chunks/` 下的代码块:
  先找主脚本旁边的 `vendor/chunks/`,找不到再回退到
  `https://unpkg.com/@sveltia/cms@0.271.0/dist/chunks/`。
  - `additions` **已经入库**,从本站加载:后端是 GitHub 且 `auth_type: additions` 时加载
    (本站 `admin/config.yml` 正是这种配置),登录、登出、评论、协作锁、用户管理都在
    这个代码块里。
  - `react-dom` **已经入库**(2026-11-25 补入),连同它静态导入的
    `chunks/assets/rolldown-runtime-BWaJ3C7D.js`:CMS 渲染自定义 React 组件(自定义字段控件、
    自定义页面)时加载。本站的自定义界面靠它,所以这两个文件必须在这里,否则每次打开带
    自定义控件的页面都要访问 UNPKG。`react-dom.js` 只导入这一个运行时文件,后者不导入任何
    东西,所以这两个就是完整的依赖。
  - `qrcode`(用手机登录的二维码)、`git`(本地仓库工作流)、`gitea` / `gitlab`(其它 Git
    后端)、`map`(Map 字段)**没有入库**:本站不使用这些功能,不会加载;一旦用到,就会
    回退到 UNPKG。官方 `dist/chunks/assets/` 里的 `_shared-module_33` 是这些代码块的依赖,
    `additions` 和 `react-dom` 都用不到,所以也没有入库。
- **界面翻译。** 英文以外的界面语言包(包括简体中文 `zh-CN`)从
  `https://unpkg.com/@sveltia/cms@0.271.0/locales/` 加载。
- **字体。** 界面字体(Source Sans 3、Noto Mono、Material Symbols Outlined)从
  `cdn.jsdelivr.net` 加载。
- **其它按需库。** 代码高亮(Shiki)、富文本模式用的 Markdown 序列化库 Turndown,以及
  图片处理、PDF、地图等功能的附加库,用到时从 UNPKG 加载。
- **版本检查与服务状态。** 启动时会请求 `https://unpkg.com/@sveltia/cms/package.json`,
  看有没有新版本;后端是 GitHub 时还会向 `https://www.githubstatus.com` 查询 GitHub 的
  服务状态。

2026-11-23 用本机构建好的站点核对过上面关于代码块的结论:只入库主文件时,登录页要先请求
`vendor/chunks/additions.js`(404),再从 UNPKG 把它取回来;把上面 4 个文件放到
`vendor/chunks/` 之后,登录流程就全部从本站加载,不再向 UNPKG 要代码块。

以上都可以在入库文件里搜字符串核对,例如 `unpkg.com/@sveltia/cms@0.271.0/dist/`、
`The additions chunk is not loaded yet`、`unpkg.com/@sveltia/cms@0.271.0/locales`。
`additions` 的加载条件另见官方文档 <https://sveltiacms.app/en/docs/additions/setup>。

文件里还打包了 React、DOMPurify 等第三方库,它们各自的许可注释保留在文件中。

2026-11-25 核对过 `react-dom` 这条:不补这两个文件时,打开带自定义控件的页面会先请求
`vendor/chunks/react-dom.js`(404),再从 UNPKG 把它和 `rolldown-runtime` 取回来;补上之后两个
文件都从本站加载(实测都是 200),自定义界面的渲染不再访问 UNPKG。

## 许可证

后补的两个文件随 `@sveltia/cms` 一起发布,各自带有的许可:

| 文件 | 许可 | 依据 |
|---|---|---|
| `chunks/react-dom.js` | MIT,Copyright (c) Meta Platforms, Inc. and affiliates | 文件里保留了三段 `@license React` 头(`scheduler`、`react-dom`、`react-dom-client` 各一段)。这是 CMS 内置的 React 19.3.1 的 DOM 运行时 |
| `chunks/assets/rolldown-runtime-BWaJ3C7D.js` | MIT,Copyright (c) 2024-present VoidZero Inc. & Contributors | 文件本身没有许可头。它是打包工具 Rolldown 的运行时片段,Rolldown 在 npm 上声明的许可是 MIT。打进 0.271.0 的 Rolldown 具体是哪个版本,没有查 |

`@sveltia/cms` 以 MIT 许可证发布。下面是 tarball 里 `LICENSE.txt` 的原文:

```text
MIT License

Copyright (c) 2026 Kohei Yoshino.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
