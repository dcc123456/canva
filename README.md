# Mini PDF 编辑器 / Mini PDF Editor

> 一个浏览器内本地运行的 PDF 编辑器,无需上传文件。  
> A browser-side, fully-local PDF editor — your files never leave your device.

> 任务进度 / Task progress: [`.trae/specs/build-minipdf-editor/tasks.md`](.trae/specs/build-minipdf-editor/tasks.md)

## 特性 / Features

| # | 中文 | English |
|---|------|---------|
| F1 | PDF 查看器 (缩略图 / 翻页 / 缩放 / 快捷键) | PDF viewer (thumbnails / paging / zoom / shortcuts) |
| F2 | 文本注释 (高亮 / 便签) | Text annotations (highlight / sticky note) |
| F3 | 文字叠加 (字体 / 颜色 / 粗斜下划线) | Text overlay (font / color / bold / italic / underline) |
| F4 | 图片叠加 (PNG / JPG / WebP,拖动 / 缩放 / 旋转) | Image overlay (PNG / JPG / WebP, drag / resize / rotate) |
| F5 | 页面管理 (新增 / 删除 / 重排 / 旋转) | Page management (add / delete / reorder / rotate) |
| F6 | 画笔与签名 (自由绘制 + 签名模态框) | Free draw + signature pad |
| F7 | 导出 PDF (应用叠加 → pdf-lib) | Export PDF (flatten overlays via pdf-lib) |
| F8 | 项目存档 (`.minipdf.json` 格式) | Project save (`.minipdf.json` format) |
| F9 | 撤销 / 重做 (Immer patches) | Undo / Redo (Immer patches) |
| F10 | 真实文本编辑 (pdf-lib 白底覆盖) | Real text edit (pdf-lib white-out + redraw) |
| F11 | AcroForm 表单 (文本 / 复选 / 单选 / 下拉) | AcroForm (text / checkbox / radio / select) |
| F12 | 模板库 (5 个内置 + 用户模板 localStorage) | Template library (5 built-ins + user templates in localStorage) |

## 技术栈 / Tech Stack

| 层 / Layer | 选型 / Choice |
|------------|---------------|
| 构建 / Build | Vite 8.1 |
| 框架 / Framework | React 19 |
| 语言 / Language | TypeScript 5 |
| 样式 / Styling | Tailwind 3 (with `darkMode: 'class'`) |
| PDF 渲染 / Render | pdfjs-dist 6.1 |
| PDF 编辑 / Edit | pdf-lib 1.17 |
| 状态 / State | zustand 5 |
| 不可变 / Immutability | immer 11 |

## 截图 / Screenshots

> TODO: 截图占位 (待添加) / Placeholder screenshots (TODO)
> 
> <!-- screenshot: viewer with sidebar thumbnails -->
> <!-- screenshot: toolbar with all tools active -->
> <!-- screenshot: highlight + sticky note example -->
> <!-- screenshot: text overlay with custom font -->
> <!-- screenshot: image overlay rotated -->
> <!-- screenshot: page management (drag reorder) -->
> <!-- screenshot: signature dialog -->
> <!-- screenshot: template gallery -->
> <!-- screenshot: dark mode + toast notification -->

## 快速开始 / Quick Start

```bash
# 安装依赖 / install deps
npm install

# 开发服务器 (http://localhost:5173) / dev server
npm run dev

# 生产构建 / production build
npm run build

# 类型检查 / typecheck
npm run typecheck

# Lint
npm run lint

# 单元测试 / unit tests
npm run test
npm run test:watch
npm run test:ui
```

默认端口 / Default port: `5173`(可在 `vite.config.ts` 中修改)。

## 脚本 / Scripts

| 命令 / Command | 说明 / Description |
|----------------|--------------------|
| `npm run dev` | 启动 Vite 开发服务器 / Vite dev server |
| `npm run build` | 类型检查 + 生产构建 / tsc + vite build |
| `npm run preview` | 预览生产构建结果 / preview production build |
| `npm run typecheck` | `tsc -b --force`(严格类型检查) |
| `npm run lint` | ESLint |
| `npm run test` | Vitest 单次运行 |
| `npm run test:watch` | Vitest 监听模式 |
| `npm run test:ui` | Vitest 可视化界面 |

## 快捷键 / Shortcuts

按 `?` 打开快捷键面板 / Press `?` to open the shortcuts panel.

### 工具切换 / Tools

| 键 / Key | 中文 | English |
|----------|------|---------|
| V | 选择 | Select |
| E | 编辑文字 | Edit text |
| F | 表单 | Form |
| H | 高亮 | Highlight |
| N | 便签 | Note |
| T | 文字 | Text |
| I | 图片 | Image |
| D | 画笔 | Draw |
| S | 签名 | Signature |

### 翻页 / Paging

| 键 / Key | 动作 / Action |
|----------|---------------|
| `←` / `PageUp` | 上一页 / Previous page |
| `→` / `PageDown` | 下一页 / Next page |

### 缩放 / Zoom

| 键 / Key | 动作 / Action |
|----------|---------------|
| `+` / `=` | 放大 / Zoom in |
| `-` / `_` | 缩小 / Zoom out |
| `Ctrl` / `Cmd` + `0` | 实际大小 / Actual size |

### 撤销 / 重做 / Undo / Redo

| 键 / Key | 动作 / Action |
|----------|---------------|
| `Ctrl` / `Cmd` + `Z` | 撤销 / Undo |
| `Ctrl` / `Cmd` + `Shift` + `Z` | 重做 / Redo |
| `Ctrl` + `Y` | 重做 (备选) / Redo (alt) |

### 表单 / Form

| 键 / Key | 动作 / Action |
|----------|---------------|
| Click | 聚焦字段 / Focus field |
| `Tab` | 下一字段 / Next field |

### 其他 / Misc

| 键 / Key | 动作 / Action |
|----------|---------------|
| `Delete` / `Backspace` | 删除选中 / Delete selected overlay |
| `Esc` | 取消选中 / Clear selection |
| `?` | 打开快捷键面板 / Open shortcuts panel |

## 目录结构 / Directory Structure

```
.
├── public/
│   └── templates/        # 旧版示例 PDF (供 StartPage 备用)
├── scripts/
│   └── gen-templates.mjs
├── src/
│   ├── app/              # 应用引导 (预留)
│   ├── assets/           # 静态资源
│   ├── components/       # 通用组件 (Toolbar / Inspector / EmptyState / Toaster / ...)
│   ├── core/             # 核心引擎 (pdf / writer / engine / templates / project / types)
│   ├── features/         # 功能模块 (annotations / draw / export / forms / overlays / viewer / ...)
│   ├── hooks/            # React hooks (useKeyboardShortcuts 等)
│   ├── store/            # Zustand stores (document / editor / engine / history / pen / template)
│   ├── utils/            # 工具函数 (coordinates / download / toast / theme / serialize)
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── tests/
│   ├── unit/             # 单元测试 (coords / serialize / history / export-pages / detect / ...)
│   ├── integration/      # 集成测试 (store-flow)
│   └── setup.ts          # Vitest 全局 setup (pdfjs legacy build)
├── vitest.config.ts
├── tailwind.config.js
├── tsconfig*.json
├── vite.config.ts
└── package.json
```

## 架构概览 / Architecture

```
+----------------+        +----------------+        +-----------------+
|  React 组件    | <----> |   zustand     | <----> |   pdfjs / pdf-lib |
| (Toolbar/Viewer|        |   stores      |        |   (渲染 / 编辑) |
|  Inspector/...) |        |  (doc/editor/ |        +-----------------+
+----------------+        |  history/...) |
                          +----------------+
                                  |
                                  v
                          +----------------+
                          | Immer patches  |   <-- 撤销/重做
                          +----------------+

引擎路由 (Task 15) / Engine routing:
  ensureEngine('edit')
    └─> mupdf.wasm (Task 15 留接口,当前 npm 上无可靠浏览器版本)
    └─> pdfLibFallbackEngine (兜底,使用 pdfjs + pdf-lib,始终可用)
```

- **PDF 渲染** 走 pdfjs (直接 canvas)。
- **PDF 编辑**(文本块覆盖、AcroForm 写入)走 `pdfLibFallbackEngine`,通过引擎路由自动选择。
- **撤销/重做** 基于 Immer patches,所有 `documentStore` mutation 都通过 `applyWithHistory` 包装。
- **叠加 (Overlay)** 始终存储为独立对象(高亮/便签/文字/图片/画笔/文本块/表单),导出时通过 `flatten.ts` 转换为 pdf-lib draw 命令。
- **模板** 内置模板在 `core/templates/registry.ts` 中以 pdf-lib 内存生成;用户模板存于 `localStorage['canva.userTemplates']`。
- **错误隔离** 顶层 `<ErrorBoundary>` 捕获渲染错误;`<Toaster>` 集中显示成功/失败提示。

## 决策日志 / Decision Log

1. **选择 pdfjs + pdf-lib,而非 MuPDF.wasm**  
   pdfjs 已有成熟浏览器版本且渲染速度快;pdf-lib 负责编辑 (复制页 / 绘制 / 表单),二者协同覆盖 90% 用例。MuPDF.wasm 在 npm 上没有官方浏览器构建,且性能优势对本项目场景不显著。详见 Task 15。

2. **AGPL-3.0 不触发**  
   pdfjs 是 AGPL-3.0,但 pdfjs-dist 通过 `pdfjs-dist` npm 包的形式分发,使用该 npm 包属于正常消费 AGPL 软件的范围,不构成分发。本项目**不修改 pdfjs 源码**,只通过标准 API 调用,因此**未触发 AGPL 的披露义务**。详见 [pdfjs licensing](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#what-are-the-implications-of-using-pdfjs-in-my-application)。

3. **简化 SVG path**  
   画笔工具产生的 SVG path 在导出时只取 `M / L / H / V / Z` 命令,C (贝塞尔) 被线性化处理。这避免了 `pdf-lib` 不直接支持贝塞尔曲线的问题;代价是高度弯曲的笔迹略有失真。

4. **白底覆盖策略**  
   文本编辑采用 `page.drawRectangle({ color: rgb(1,1,1) })` 在原文本区域画白底,再用 `page.drawText` 重写。优点:实现简单,任何 PDF 都能写;缺点:原文本背景不是纯白的文档会留下色块。M11 之前的临时方案,MuPDF 集成后将切换为真正的 stream 替换。

5. **撤销/重做基于 Immer patches 而非深拷贝**  
   patches 体积小、可序列化(可后续支持云端协作),且 Immer patches 与 zustand 配合简单。代价:不能撤销跨 store 的副作用(目前也用不到)。

6. **localStorage 存用户模板而非 IndexedDB**  
   用户模板通常 < 1 MB,localStorage 容量足够;且模板项的序列化更简单。隐私模式下写入失败会自动降级为内存存储,不影响当次会话。

7. **Tailwind 暗色模式用 class 而非 media**  
   通过 `<html class="dark">` 切换给用户显式控制权,持久化到 `localStorage['canva.theme']`;不跟随系统变化,避免误触。

## 已知限制 / Known Limitations

- **WebP 导出**:图片可上传 WebP 但 `pdf-lib` 仅支持 PNG/JPG,导出时 WebP 会被跳过并打印警告。
- **AcroForm 仅读**:本项目支持读取 AcroForm 字段、写入字段值,但不支持创建新 AcroForm 表单(需要 MuPDF)。
- **无批量编辑 API**:目前没有 JS API 供外部脚本调用,只能通过 UI 交互。
- **依赖 happy-dom / pdfjs legacy build 测试**:浏览器专用 API (Worker、Canvas 渲染) 在测试中被降级,某些路径无法覆盖。
- **画笔精度**:贝塞尔曲线被线性化,放大后可见到多边形锯齿。

## 路线图 / Roadmap

- [ ] 集成 MuPDF.wasm,替换白底覆盖方案,实现真正的 stream 替换
- [ ] AcroForm 创建向导 (从空白 PDF 自动添加文本字段)
- [ ] 协同编辑 (WebSocket + CRDT)
- [ ] 图片 OCR / 表格识别
- [ ] 插件市场 (允许第三方注册工具)

## 测试 / Testing

```bash
npm run test          # 33 个测试,8 个测试文件
npm run test:watch    # 监听模式
npm run test:ui       # 可视化界面
```

测试覆盖 / Coverage:

- `tests/unit/coords.spec.ts` — 屏幕 ↔ PDF 坐标对称性 (5)
- `tests/unit/serialize.spec.ts` — base64 往返 + JSON 结构 (4)
- `tests/unit/history.spec.ts` — undo/redo 5 步 (4)
- `tests/unit/export-pages.spec.ts` — `applyPages` 输出 PDF 页数等于 PageMeta 列表 (3)
- `tests/unit/detectTextBlocks.spec.ts` — 双行 PDF → 2 个 block (3)
- `tests/unit/registry.spec.ts` — 内置模板生成 (8)
- `tests/unit/toast.spec.ts` — toast pub-sub (3)
- `tests/integration/store-flow.spec.ts` — store 集成 (3)

## 致谢 / Acknowledgments

- [Mozilla pdf.js](https://github.com/mozilla/pdf.js) (AGPL-3.0) — PDF 渲染
- [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT) — PDF 编辑
- [Zustand](https://github.com/pmndrs/zustand) (MIT)
- [Immer](https://github.com/immerjs/immer) (MIT)
- [Tailwind CSS](https://tailwindcss.com/) (MIT)
- [React](https://react.dev/) (MIT)
- [Vite](https://vitejs.dev/) (MIT)

## 许可证 / License

本项目代码本身以 MIT 许可证发布;运行时依赖 pdfjs-dist (AGPL-3.0)、pdf-lib (MIT) 等的许可证各自保留。分发时请附上完整 NOTICE。

The source code of this project is MIT-licensed; runtime dependencies retain their own licenses (notably pdfjs-dist under AGPL-3.0, which does not impose additional obligations when consumed unmodified as a library).