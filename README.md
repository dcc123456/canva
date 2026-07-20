# Mini PDF 编辑器 / Mini PDF Editor

> 一个浏览器内本地运行的 PDF 编辑器,无需上传文件、无需登录、无后端。
> A browser-side, fully-local PDF editor - your files never leave your device.

> 任务进度 / Task progress: [`.trae/specs/build-minipdf-editor/tasks.md`](.trae/specs/build-minipdf-editor/tasks.md)

## 特性 / Features

| # | 中文 | English |
|---|------|---------|
| F1 | PDF 查看器 (缩略图 / 翻页 / 缩放 / 快捷键) | PDF viewer (thumbnails / paging / zoom / shortcuts) |
| F2 | 文本注释 (高亮 / 便签) | Text annotations (highlight / sticky note) |
| F3 | 文本叠加 (字体 / 颜色 / 粗斜下划删除线 / 富文本段) | Text overlay (font / color / bold / italic / underline / strike / rich-text segments) |
| F4 | 图片叠加 (PNG / JPG / WebP,拖动 / 缩放 / 旋转) | Image overlay (PNG / JPG / WebP, drag / resize / rotate) |
| F5 | 页面管理 (新增 / 删除 / 重排 / 旋转) | Page management (add / delete / reorder / rotate) |
| F6 | 画笔与签名 (自由绘制 + 签名模态框) | Free draw + signature pad |
| F7 | 导出 PDF (矢量保留 + 字符级覆盖管线) | Export PDF (vector-preserving + char-level overlay pipeline) |
| F8 | 项目存档 (`.minipdf.json` 格式) | Project save (`.minipdf.json` format) |
| F9 | 撤销 / 重做 (Immer patches) | Undo / Redo (Immer patches) |
| F10 | 真实文本编辑 (三引擎路由 + TipTap 富文本 + 按段落分割) | Real text edit (3-engine router + TipTap rich text + paragraph segmentation) |
| F11 | AcroForm 表单 (文本 / 复选 / 单选 / 下拉) | AcroForm (text / checkbox / radio / select) |
| F12 | 模板库 (5 个内置 + 用户模板 localStorage) | Template library (5 built-ins + user templates in localStorage) |

### F10 能力详情 / Real Text Edit Details

- **三引擎路由** 按优先级自动选择,首次失败自动降级:
  1. **MuPDF.js (WASM)** - 字节级 `Redact + applyRedactions` 真删字
  2. **PDFium** - `FPDFPageObj_Destroy` 删除原页面对象 + 重画
  3. **pdf-lib overlay** - 白底覆盖 + 重画(最末兜底,非字节级)
- **TipTap 富文本编辑器** 支持 bold / italic / underline / strike / color / fontSize / fontFamily 七种内联样式,空格与换行完整保留(`preserve-spans` + `preserveWhitespace:'full'`)
- **按段落分割文本块** 同行 atom 水平间距 > 3 倍平均字符宽度时拆分为独立块;段落合并要求字号(1.1x 内)、粗细、斜体、对齐一致,行距阈值基于实际字符宽度自适应
- **字符级 quad 收集** (`core/writer/textQuad.ts`) 精确白底覆盖原字位置,避免色块溢出
- **CJK 字体支持** (`@pdf-lib/fontkit`) 内嵌中文字体子集化,导出 PDF 文字可复制可搜索
- **Web 安全字体映射 (ADR 0001)** PDF 字体名归一化到 5 类 fontClass(`sans`/`serif`/`mono`/`cjk-sans`/`cjk-serif`),TipTap 与 pdf-lib 用同一份字体文件保证视觉一致。原 PDF 嵌入字体不再抽取重嵌。
- **Span 级颜色抽取 (ADR 0002)** `extractTextColors` 按 atom bbox 精确匹配,段内混色(红字+黑字)保留。`segment.color` 透传到 TipTap 浮层与导出端。
- **全文本重画 (ADR 0003) -- 已回退**:原计划所有 detected text-block 都在导出时重画,以避免编辑边界字体跳变。但因目前缺少 Source Han Sans Bold 字重 + 颜色抽取精度不足,重画会丢失原 PDF 的 bold/color/size 信息,已暂时回退为"仅重画编辑过的块"。"矢量保留"暂时恢复为完整原 PDF 字节保留(未编辑部分)。
- **矢量保留** 编辑只改 overlay,导出时统一通过 `core/writer/textBlockEdits.ts` 应用。原 PDF 矢量元素(图片、矢量图形、表格线)全部保留;未编辑的文本块保留原嵌入字体(完整样式),仅编辑过的块走映射字体重画。

## 技术栈 / Tech Stack

| 层 / Layer | 选型 / Choice |
|------------|---------------|
| 构建 / Build | Vite 8.1 |
| 框架 / Framework | React 19.2 |
| 语言 / Language | TypeScript 5.9 |
| 样式 / Styling | Tailwind 3.4 (with `darkMode: 'class'` + 多主题色系统) |
| PDF 渲染 / Render | pdfjs-dist 6.1 |
| PDF 写入 / Write | pdf-lib 1.17 + @pdf-lib/fontkit 1.1 (CJK) |
| PDF 引擎 (增强) / Engine | mupdf 1.27 (WASM, 懒加载) + @embedpdf/pdfium 2.14 |
| 富文本 / Rich text | @tiptap/react 3.27 + starter-kit / color / font-family / text-style / underline |
| 状态 / State | zustand 5 |
| 不可变 / Immutability | immer 11 |

## 截图 / Screenshots

> TODO: 截图占位 (待添加) / Placeholder screenshots (TODO)
> 
> <!-- screenshot: Canva-style partitioned layout -->
> <!-- screenshot: TopBar + ToolSidebar + Sidebar + Viewer + Inspector + BottomBar -->
> <!-- screenshot: text-block edit with TipTap floating toolbar -->
> <!-- screenshot: multi-theme color switcher -->
> <!-- screenshot: dark mode -->

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
| `->` / `PageDown` | 下一页 / Next page |

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
│   ├── components/       # 通用组件 (TopBar / ToolSidebar / BottomBar / Inspector /
│   │                     #   Toolbar / FloatingTextToolbar / SignatureDialog /
│   │                     #   EmptyState / ErrorBoundary / Toaster / ShortcutsModal /
│   │                     #   LoadingOverlay)
│   ├── core/             # 核心引擎
│   │   ├── pdf/          # pdfjs 渲染 (loader / renderer / textColor)
│   │   ├── writer/       # pdf-lib 写入 (flatten / pages / text-overlay /
│   │   │                 #   textBlockEdits / textQuad / redact / cjkFont /
│   │   │                 #   fontExtract (已删除) / formFields / helpers)
│   │   ├── mupdf/        # MuPDF.js 封装 (loader / mupdfEngine - 真删字 redact)
│   │   ├── pdfium/       # PDFium 封装 (loader / pdfiumEngine - 备用引擎)
│   │   ├── engine/       # 引擎路由 (router / types / pdfLibFallback /
│   │   │                 #   fontClassify - 字体名 -> fontClass 映射)
│   │   ├── project/      # 序列化 (serialize / deserialize)
│   │   ├── templates/    # 模板库 (registry / builtin / user / user-templates / thumbnail)
│   │   └── types.ts
│   ├── features/         # 功能模块
│   │   ├── viewer/       # F1 (Viewer / Sidebar / CanvasInteractionLayer)
│   │   ├── overlays/     # 通用叠加层 (OverlayLayer / SelectionFrame / ElementRenderer)
│   │   ├── text-edit/    # F10 (RichTextEditor / TextBlockEditLayer / detectTextBlocks /
│   │   │                 #   useAutoDetectTextBlocks / useCommitTextBlock / reflow / runEngineDetection)
│   │   ├── forms/        # F11 (FormFieldOverlay / detectFormFields)
│   │   ├── export/       # F7 (exportPdf)
│   │   ├── templates/    # F12 (TemplateGallery)
│   │   └── project-io/   # F8 (loadProject / saveProject)
│   ├── hooks/            # React hooks (useKeyboardShortcuts / useEngineLoad)
│   ├── store/            # Zustand stores (document / editor / engine / history / pen / template)
│   ├── utils/            # 工具函数 (coordinates / download / toast / theme / serialize)
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── tests/
│   ├── unit/             # 单元测试 (coords / serialize / history / export-pages /
│   │                     #   detectTextBlocks / registry / toast / engineStore /
│   │                     #   mupdfEngine / pdfiumEngine / readUtf16LE)
│   ├── integration/      # 集成测试 (store-flow / pdfbytes / resume)
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
|  React 组件    | <----> |   zustand     | <----> |   pdfjs-dist    |
| (TopBar/Viewer |        |   stores      |        |   (渲染)        |
|  Inspector/...) |        |  (doc/editor/ |        +-----------------+
+----------------+        |  history/...) |
                          +-------+--------+
                                  |
                                  v
                          +----------------+        +-----------------+
                          | engine router  | -----> |   pdf-lib       |
                          | ensureEngine() |        | (写入 / flatten)|
                          +-------+--------+        +-----------------+
                                  |
                  +---------------+---------------+
                  v               v               v
          +----------+    +-----------+    +----------------+
          |  MuPDF   |    |  PDFium   |    | pdf-lib overlay|
          |  (WASM)  |    |           |    | (白底覆盖兜底) |
          | 真删字   |    | 删对象+重画|   +----------------+
          +----------+    +-----------+
                                  |
                                  v
                          +----------------+
                          | Immer patches  |   <-- 撤销/重做
                          +----------------+
```

**引擎路由 (`core/engine/router.ts`)**:
- `'render'` 模式始终返回 `pdfLibFallback`(实际渲染由 `core/pdf/renderer.ts` 直接走 pdfjs)。
- `'edit'` 模式按优先级试探,首次解析成功后会被缓存:
  1. **MuPDF.js** - 真正的字节级删字 (Redact + applyRedactions)
  2. **PDFium** - 备用,通过 `FPDFPageObj_Destroy` 删字 + 重画
  3. **pdf-lib overlay** - 最末兜底,白底覆盖 + 重画,非字节级
- 加载期间通过 `LoadingOverlay` 全屏进度条反馈,失败时自动降级。

**核心设计原则**:

- **PDF 渲染** 走 pdfjs(直接 canvas)。
- **PDF 编辑**(文本块覆盖、AcroForm 写入、矢量保留)走引擎路由自动选择。
- **编辑只改 overlay** 文本块编辑时不直接回写 pdfBytes,导出时统一通过 `core/writer/textBlockEdits.ts` 应用(字符级白底 + 重画),原 PDF 矢量元素全部保留。
- **撤销/重做** 基于 Immer patches,所有 `documentStore` mutation 都通过 `applyWithHistory` 包装。
- **叠加 (Overlay)** 始终存储为独立对象(高亮/便签/文字/图片/画笔/文本块/表单),导出时通过 `flatten.ts` 转换为 pdf-lib draw 命令。
- **模板** 内置模板在 `core/templates/registry.ts` 中以 pdf-lib 内存生成;用户模板存于 `localStorage['canva.userTemplates']`。
- **错误隔离** 顶层 `<ErrorBoundary>` 捕获渲染错误;`<Toaster>` 集中显示成功/失败提示。
- **Canva 风格布局** 分区式 UI:`TopBar` / `[ToolSidebar | Sidebar | Viewer | Inspector]` / `BottomBar`,可整体切换多主题色 + 暗色模式。

## 决策日志 / Decision Log

1. **三引擎路由而非单引擎**  
   最初计划用 MuPDF.wasm 做真实文本编辑,但 npm 上的 `mupdf` 包是 Node 原生绑定,不能直接进浏览器 bundle。经过评估后采用三引擎策略:优先尝试 MuPDF.js(字节级真删字),失败降级到 PDFium(对象级删除 + 重画),最后兜底 pdf-lib overlay(白底覆盖)。这样既保留了"真编辑"能力,又保证了任何环境下都能工作。

2. **pdfjs-dist 6.1 (AGPL) 不触发披露义务**  
   pdfjs 通过 `pdfjs-dist` npm 包分发,消费未修改的 AGPL 软件不构成分发,本项目不修改 pdfjs 源码,只通过标准 API 调用。详见 [pdfjs licensing FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#what-are-the-implications-of-using-pdfjs-in-my-application)。

3. **矢量保留 + 编辑分离 + 导出统一管线**  
   重构后编辑只更新 overlay,不回写 pdfBytes。导出时 `textBlockEdits.ts` 根据文本块是否被改动决定是否需要字符级白底覆盖原字并重画新字。优点:原 PDF 矢量元素(图片、矢量图形、表格)全部保留;撤销/重做简单;编辑体验流畅。代价:导出时需要遍历所有文本块。  
   **ADR 0003 修订**:"矢量保留"范围收窄为"非文本元素保留"。所有 detected text-block 都在导出时重画(无论是否编辑),原 PDF 字体被规范化到映射字体,避免编辑边界字体跳变。

4. **TipTap 富文本编辑器**  
   选 TipTap 而非 contenteditable 自实现,因为:扩展生态成熟(starter-kit / color / font-family / text-style / underline)、JSON 结构可序列化、ProseMirror 底层保证 schema 一致性。自定义 `PreserveText` 扩展强制 `preserveWhitespace:'full'`,避免富文本段间空格被 HTML 规则折叠。

5. **按段落分割文本块 + 样式一致性检查**  
   原方案"一行一个 block"过于碎,用户体验差。改为按 baseline 聚类 + 水平间距拆分(阈值 = 3 倍平均字符宽度,基于实际字符宽度自适应)。段落合并要求字号 1.1x 内、粗细/斜体/对齐一致,行距 0.8x-2.0x 字号。这样段落级的编辑一次完成,而非逐行。

6. **字符级 quad 收集**  
   `core/writer/textQuad.ts` 通过 pdfjs `getTextContent()` 的 `transform` 矩阵反推每个字符的四个角点,用于精确白底覆盖。比按行 bbox 覆盖更精确,不会盖到相邻文字。

7. **CJK 字体子集化**  
   `@pdf-lib/fontkit` + `core/writer/cjkFont.ts` 在导出时嵌入中文字体子集(只包含实际使用的字形),避免 PDF 体积爆炸。子集化后的 PDF 文字仍可复制可搜索。

8. **撤销/重做基于 Immer patches 而非深拷贝**  
   patches 体积小、可序列化(可后续支持云端协作),且 Immer patches 与 zustand 配合简单。代价:不能撤销跨 store 的副作用(目前也用不到)。

9. **localStorage 存用户模板而非 IndexedDB**  
   用户模板通常 < 1 MB,localStorage 容量足够;且模板项的序列化更简单。隐私模式下写入失败会自动降级为内存存储,不影响当次会话。

10. **Tailwind 暗色模式用 class 而非 media**  
    通过 `<html class="dark">` 切换给用户显式控制权,持久化到 `localStorage['canva.theme']`;不跟随系统变化,避免误触。多主题色系统在此基础上扩展。

11. **Web 安全字体映射而非抽取重嵌原嵌入字体 ([ADR 0001](docs/adr/0001-web-safe-font-mapping.md))**  
    原 PDF 嵌入字体名(如 `ABCDEF+PingFangSC-Regular`)浏览器不识别,直接当 CSS font-family 永远走默认 sans-serif 兜底;`extractEmbeddedFont` 对 CID/Type1 字体常因 cmap 缺失产生乱码。改为 5 类 fontClass 映射:`sans`/`serif`/`mono`/`cjk-sans`/`cjk-serif` -> Arial / Times New Roman / Courier New / 思源黑体 / 思源宋体。TipTap 与 pdf-lib 共用同一份 `.otf` 文件,保证编辑浮层与导出 PDF 视觉一致。`fontExtract.ts` 删除。CJK 字体每个 fontClass 都有 Regular + Bold 两份字重文件,导出时按 `bold` 标志选对应字重。

12. **Span 级颜色抽取而非块级主导色 ([ADR 0002](docs/adr/0002-span-level-color-extraction.md))**  
    原 `matchColorsToBlocks` 取块内主导色,段内混色(红字+黑字)丢失。改为 `matchColorsToAtoms`:在 MuPDF 检测末尾按 atom bbox 精确匹配 showText 颜色,透传到 `segment.color`。`block.color` 降级为块级默认。代价:atom-level 匹配 O(atoms × coloredTexts),典型页面可接受。

13. **导出时重画所有 detected text-block,而非仅编辑过的 ([ADR 0003](docs/adr/0003-redraw-all-text-at-detection.md))** *(已回退)*  
    原"未编辑不重画"导致编辑边界字体跳变(用户改一字 -> 该段变 Arial,相邻段仍是原嵌入字体)。改为所有 detected text-block 都走 redaction + 重画。但因颜色抽取精度不足,重画会丢失原 PDF 的 color 信息,已暂时回退为"仅重画编辑过的块"。Bold 已通过真字重文件落地,不再需要模拟。

14. **CJK italic 模拟**  
    Source Han Sans/Serif CN 作为 CJK 字体,设计上没有 italic 变体(CJK 排版传统里没有斜体概念)。Bold 用真字重文件,italic 用 `page.pushOperators` 设置 CTM 斜切矩阵(`1 0 0.21 1 -0.21*y 0 cm`)模拟,与浏览器 CSS `font-synthesis: oblique` 行为一致。

15. **分页检测 + 后台重画流水线 ([ADR 0004](docs/adr/0004-paginated-detection-redraw-pipeline.md))** *(规划中)*  
    ADR 0003 让导出成本随页数线性增长。规划:PDF 打开后立即同步检测当前页,Web Worker 后台逐页检测其余页。导出等待所有页就绪(进度 UI)。MuPDF WASM 在持久 worker 中复用。

## 已知限制 / Known Limitations

- **WebP 导出**:图片可上传 WebP 但 `pdf-lib` 仅支持 PNG/JPG,导出时 WebP 会被跳过并打印警告。
- **AcroForm 创建**:本项目支持读取 AcroForm 字段、写入字段值,但不支持从空白 PDF 创建新 AcroForm 表单字段(需要 MuPDF 写入完整 AcroForm 字典)。
- **多行段落文本块**:段落内的多行若字号/粗细/斜体不一致,会被拆分为多个独立块;单独编辑某行时其他行保持原状。
- **MuPDF 加载体积**:MuPDF WASM 包 ~30MB,首次启用"编辑文字"或"表单"工具时需 1-3s 加载(有进度条 + 失败降级)。
- **无批量编辑 API**:目前没有 JS API 供外部脚本调用,只能通过 UI 交互。
- **依赖 happy-dom / pdfjs legacy build 测试**:浏览器专用 API (Worker、Canvas 渲染) 在测试中被降级,某些路径无法覆盖。
- **画笔精度**:贝塞尔曲线被线性化,放大后可见到多边形锯齿。
- **字体规范化 ([ADR 0001](docs/adr/0001-web-safe-font-mapping.md))**:编辑过的文本块导出时被规范化到 5 类映射字体(Arial / Times / Courier / 思源黑体 / 思源宋体)。Bold 用真字重文件,italic 用 CTM 斜切模拟(Source Han 无 italic 变体)。未编辑的块保留原 PDF 字节(原嵌入字体 + 完整样式)。
- **CJK 字体文件体积**:`public/fonts/` 下 4 个 OTF 文件共 ~40MB(思源黑 Regular/Bold + 思源宋 Regular/Bold),随项目分发。
- **分页检测流水线待落地**:ADR 0004 的 Web Worker 多线程检测尚未实现,大文档导出仍可能在主线程阻塞数秒。

## 路线图 / Roadmap

### 短期 / Short-term

- [ ] 截图补全:Canva 风格布局、TipTap 富文本编辑、多主题色、暗色模式
- [ ] 单元测试覆盖新增模块:`textBlockEdits` / `textQuad` / `redact` / `cjkFont` / `fontClassify` / `textColor` / `RichTextEditor` (TipTap 往返)
- [ ] TipTap 编辑器边界情况:多段粘贴、富文本段与纯文本混合、fontSize 精度
- [ ] 引擎降级路径集成测试:模拟 MuPDF 加载失败 -> PDFium -> pdf-lib overlay
- [ ] 改进 `matchColorsToAtoms` 精度(目前按 bbox 相交 + 主导色,可改字符级精确匹配)
- [ ] 实现 ADR 0003 的"全文本重画"(需先解决颜色抽取精度)
- [ ] 实现 ADR 0004 分页检测 + Web Worker 后台重画流水线

### 中期 / Mid-term

- [ ] AcroForm 创建向导(从空白 PDF 添加文本字段)
- [ ] MuPDF WASM 体积优化 / CDN 分发
- [ ] 图片 OCR / 表格识别(Tesseract.js 或外部 API)
- [ ] 协同编辑(WebSocket + CRDT,基于 Immer patches 已可序列化的基础)
- [ ] 插件市场(允许第三方注册工具,通过 `EngineInterface` 接入新引擎)

### 长期 / Long-term

- [ ] 移动端适配(触摸优化、手势缩放)
- [ ] PWA 离线支持(`vite-plugin-pwa` + Service Worker 缓存 WASM)
- [ ] PDF 加密 / 密码保护
- [ ] 表单字段树形结构(目前仅扁平字段)

## 测试 / Testing

```bash
npm run test          # Vitest 单次运行
npm run test:watch    # 监听模式
npm run test:ui       # 可视化界面
```

测试覆盖 / Coverage:

**单元测试 / Unit** (`tests/unit/`):
- `coords.spec.ts` - 屏幕 ↔ PDF 坐标对称性
- `serialize.spec.ts` - base64 往返 + JSON 结构
- `history.spec.ts` - undo/redo 多步
- `export-pages.spec.ts` - `applyPages` 输出 PDF 页数等于 PageMeta 列表
- `detectTextBlocks.spec.ts` - 双行 PDF -> 2 个 block
- `registry.spec.ts` - 内置模板生成
- `toast.spec.ts` - toast pub-sub
- `engineStore.spec.ts` - 引擎状态机
- `mupdfEngine.spec.ts` - MuPDF 引擎检测
- `pdfiumEngine.spec.ts` - PDFium 引擎检测
- `readUtf16LE.spec.ts` - UTF-16 LE 解码

**集成测试 / Integration** (`tests/integration/`):
- `store-flow.spec.ts` - store 集成(create -> addOverlay -> undo -> redo)
- `pdfbytes.spec.ts` - PDF bytes 往返
- `resume.spec.ts` - 简历模板端到端流程

## 致谢 / Acknowledgments

- [Mozilla pdf.js](https://github.com/mozilla/pdf.js) (AGPL-3.0) - PDF 渲染
- [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT) - PDF 编辑
- [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) (MIT) - CJK 字体子集化
- [MuPDF.js](https://github.com/ArtifexSoftware/mupdf.js) (AGPL-3.0) - 字节级 PDF 编辑
- [@embedpdf/pdfium](https://github.com/embedpdf/pdfium) - PDFium WASM 封装
- [TipTap](https://tiptap.dev/) (MIT) - 富文本编辑器
- [Zustand](https://github.com/pmndrs/zustand) (MIT)
- [Immer](https://github.com/immerjs/immer) (MIT)
- [Tailwind CSS](https://tailwindcss.com/) (MIT)
- [React](https://react.dev/) (MIT)
- [Vite](https://vitejs.dev/) (MIT)

## 许可证 / License

本项目代码本身以 MIT 许可证发布;运行时依赖 pdfjs-dist (AGPL-3.0)、mupdf (AGPL-3.0)、pdf-lib (MIT) 等的许可证各自保留。分发时请附上完整 NOTICE。

The source code of this project is MIT-licensed; runtime dependencies retain their own licenses (notably pdfjs-dist and mupdf under AGPL-3.0, which does not impose additional obligations when consumed unmodified as a library).
