# Sveltia CMS 本体来源说明

本目录的 `sveltia-cms.js` 是 Sveltia CMS 官方发布的构建产物,**原样入库**:没有加头注释、
没有格式化、没有转换行尾。它只由 `admin/index.html` 以
`<script src="./vendor/sveltia-cms.js">` 加载;构建时整个 `admin/` 目录被复制到
`dist/admin/`(在外链审计之后),不进离线 zip。

## 来源

| 项目 | 值 |
|---|---|
| 包名 | `@sveltia/cms` |
| 版本(固定) | `0.271.0` |
| npm tarball | `https://registry.npmjs.org/@sveltia/cms/-/cms-0.271.0.tgz` |
| registry integrity(`dist.integrity`,sha512 / base64) | `sha512-hdkwEshQK4aZmijVi5aVuB2yvBir6wJ5nhbrCH5+Xm1ymvbuS9AU5inBPMVFdvtvK0YJd8qAsBegJDQqN7dHCw==` |
| tarball sha1(`dist.shasum`) | `81f63a928afe577eb68554a94fa3bee6e1735efb` |
| 入库文件在 tarball 里的路径 | `package/dist/sveltia-cms.js` |
| 入库文件大小 | 2,669,038 字节(LF 行尾,文件末尾没有换行符) |
| 获取日期 | 2026-11-23 |
| 许可证 | MIT(全文见文末) |

sha256(sveltia-cms.js) = `1039b653e9197f0117433933456abc707f55a36ab40ff81d828dbc20fdf16fd1`

获取时用 Node 内置的 `crypto.createHash('sha512')` 对 tarball 求 base64 摘要,与 registry
实时返回的 `dist.integrity` 一致后才解包;入库文件与解包出的原文件用 `cmp` 逐字节比对一致。

## 怎样复核

`tests/admin-config.test.js`(`npm test`)每次都会把入库文件的 sha256 与上面那一行比对。
仓库根目录的 `.gitattributes` 把这个文件标为 `-text`,所以任何平台检出时 git 都不会转换它的行尾。

想和官方产物重新逐字节比对(需要联网):

```bash
curl -sO https://registry.npmjs.org/@sveltia/cms/-/cms-0.271.0.tgz
tar -xzf cms-0.271.0.tgz package/dist/sveltia-cms.js
cmp package/dist/sveltia-cms.js admin/vendor/sveltia-cms.js && echo identical
```

升级版本时:改本页的版本号、integrity、sha256 三处,并替换 `sveltia-cms.js`。

## 已知限制:这不是一个自包含的文件

入库的是官方的 **CDN 构建**——单文件经典脚本,不需要打包器,但它是按需加载的:
一部分代码和资源不在本文件里,运行时从网络上取。自托管并不能让 CMS 完全离线运行。

- **按需代码块(chunks)。** 主脚本用 `import()` 加载官方包里 `dist/chunks/` 下的代码块:
  先找主脚本旁边的 `vendor/chunks/`,找不到再回退到
  `https://unpkg.com/@sveltia/cms@0.271.0/dist/chunks/`。本仓库**没有入库** `chunks/`,
  所以下面这些功能都依赖 UNPKG:
  - `additions`:后端是 GitHub 且 `auth_type: additions` 时加载。**本站 `admin/config.yml`
    正是这种配置**——登录、登出、评论、协作锁、用户管理都在这个代码块里。
  - `qrcode`(用手机登录的二维码)、`git`(本地仓库工作流)、`gitea` / `gitlab`(其它 Git
    后端)、`map`(Map 字段)、`react-dom`(自定义 React 组件的预览):本站都不使用,不会加载。

  2026-11-23 用本机构建好的站点核对过:只入库主文件时,登录页要先请求
  `vendor/chunks/additions.js`(404),再从 UNPKG 把它取回来。把官方的
  `dist/chunks/additions.js` 和 `dist/chunks/assets/` 一并放到 `admin/vendor/chunks/`,
  登录流程就全部从本站加载,不再向 UNPKG 要代码块。
- **界面翻译。** 英文以外的界面语言包(包括简体中文 `zh-CN`)从
  `https://unpkg.com/@sveltia/cms@0.271.0/locales/` 加载。
- **字体。** 界面字体(Source Sans 3、Noto Mono、Material Symbols Outlined)从
  `cdn.jsdelivr.net` 加载。
- **其它按需库。** 代码高亮(Shiki)、富文本模式用的 Markdown 序列化库 Turndown,以及
  图片处理、PDF、地图等功能的附加库,用到时从 UNPKG 加载。
- **版本检查与服务状态。** 启动时会请求 `https://unpkg.com/@sveltia/cms/package.json`,
  看有没有新版本;后端是 GitHub 时还会向 `https://www.githubstatus.com` 查询 GitHub 的
  服务状态。

以上都可以在入库文件里搜字符串核对,例如 `unpkg.com/@sveltia/cms@0.271.0/dist/`、
`The additions chunk is not loaded yet`、`unpkg.com/@sveltia/cms@0.271.0/locales`。
`additions` 的加载条件另见官方文档 <https://sveltiacms.app/en/docs/additions/setup>。

文件里还打包了 React、DOMPurify 等第三方库,它们各自的许可注释保留在文件中。

## 许可证

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
