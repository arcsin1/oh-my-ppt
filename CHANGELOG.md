# 更新日志 / Changelog

## 2026-09-04 · v2.5.0

### 中文

- 新增图表编辑：双击图表即可改数据、换图表类型、调图例颜色。
- 新增全新元素编辑交互：选中元素即出现悬浮工具条快捷操作，双击打开属性面板精细编辑（迈入新的编辑方式阶段）。
- 新增配图描述一键生成：「大纲提示词」生成插图描述，「风格提示词」生成匹配当前页风格的背景图描述，更加匹配当前页面。
- 新增生图厂商接入：支持gpt-image-2等生图，可选择的生图服务更多、出图质量更好，更便宜，稳定。
- 新增会话导出完整保留当前ppt的完整风格，分享给别人的演示不再丢风格。
- 新增文档解析可取消，长文档不用等待。
- 新增页面生成并发设置：可在高级设置中自定义同时生成的页面数（1-10），整体出稿更快。
- 优化一键配图：根据页面角色自动选择焦点插图或背景底图，配图完成前自动检查版面，溢出与遮挡问题可自动修复。
- 优化新增页面流程：新增页面直接基于正文素材生成并追加到末尾，速度更快、内容更聚焦。
- 优化生成体验：样式大幅优化，生成进度按页面卡片归组展示，每页状态与日志一目了然；初次生成界面更简洁清爽。
- 优化 PPTX 导出：升级导出引擎，旋转卡片等内容改为原生导出，还原度更高，以及元素层级问题优化。
- 优化安装包体积：产物压缩与按需加载，安装包显著更小、启动更快（减少20%～30%体积）。
- 优化 AI 模式响应性能与 OpenAI 系模型的兼容性。
- 修复 Word 文档导入时标题层级识别错误、加粗残留与空表头问题，以及解析大纲更加匹配。
- 修复大纲生成对 thinking 类模型的参数兼容问题，统一一致跟一键创建的模式。
- 修复多处弹窗层级遮挡、会话创建页提示卡住、图表预览偶发空白与公式选择不匹配等问题。
- 修复生成时候会把【受众和主张的信息】在 PPT 正文体现带入生成内容中的问题。

### English

- Added chart editing: double-click a chart to edit its data, switch chart types, and adjust legend colors.
- Added a new element editing experience: selecting an element shows a floating toolbar for quick actions, and double-clicking opens the properties panel for detailed editing.
- Added one-click prompt generation: "Outline prompt" writes an illustration description, while "Style prompt" writes a background description matching the current slide's look.
- Added a new image-model provider, expanding your options with higher-quality output.
- Added full style preservation in session export, so shared decks keep their look.
- Added cancellation for document analysis, so long documents no longer keep you waiting.
- Added a page-generation concurrency setting: choose how many slides generate at once (1-10) in advanced settings for faster decks.
- Improved one-click illustration: automatically picks a focal illustration or background plate based on the slide's role, and audits the layout before finishing so overflow and overlap can self-heal.
- Improved the add-page flow: new pages generate directly from body material and append to the end — faster and more focused.
- Improved the generation experience: progress and logs are now grouped into per-slide cards with a cleaner first-run layout.
- Improved PPTX export: the upgraded engine exports rotated cards and similar content natively with higher fidelity.
- Improved the app footprint: compressed assets and lazy loading make the installer notably smaller and startup faster.
- Improved AI-mode responsiveness and compatibility with OpenAI-style models.
- Fixed heading-level, bold-residue, and empty-header issues when importing Word documents.
- Fixed thinking-parameter compatibility in outline generation.
- Fixed dialog layering issues, a stuck tooltip on the creation page, occasional blank chart previews, and formula selector mismatches.


## 2026-08-22 · v2.4.0

### 中文

- 新增全新创作流程：上传文档自动生成可视化大纲，可逐页查看和编辑内容，确认无误后再生成整套演示。
- 新增整套一键美化（全页）：一次操作优化全部页面，逐页处理、逐页保存，进度实时可见。
- 新增全元素旋转：所有元素都可拖动旋转，也可在属性面板输入精确角度。
- 新增对话创作网页链接支持：粘贴网址即可轻量抓取网页内容并自动整理为大纲，网页文章、博客也能直接用来创作演示。
- 优化所有生成和修改效率：初次生成速度大幅提升 30% 以上，更多环节接入多模态视觉能力，让 AI 能"看懂"页面与图片。
- 优化生成忠实度：从大纲生成时完整保留原文内容（不自己胡编乱造），长资料不再丢内容。
- 优化 AI 修改的内容保护：对话修改、一键美化与换风格更严格保留原有文字和数据，避免内容被改丢。
- 优化失败重试：失败页面带着失败原因重试，能定点修复的不整页重做，成功率更高。
- 优化 PPTX 导入编辑：修复文字与矢量图片丢失的问题，图表、文本换行与艺术字还原更好，导入后更接近原稿。
- 优化导入风格抽取：更准更快，并直接以原稿封面作为风格预览图。
- 优化模板与创意创建，内置风格全部自带真实预览图，挑选更直观。
- 修复 Windows 下部分预览图无法显示的问题。
- 修复会话卡片生成用时显示异常的问题。
- 修复编辑页 AI 模式的异常处理问题。
- 修复重试过程中加载状态重叠等若干问题。

### English

- Added a rebuilt creation flow: upload a document to get a visual outline, review and edit it page by page, then generate the full presentation once it looks right.
- Added whole-deck beautification: improve every slide in one action, processed and saved page by page with live progress.
- Added element rotation: rotate any element by dragging or enter an exact angle in the inspector.
- Added web link support in Chat to Create: paste a URL to lightly fetch the page content and have it organized into an outline, so web articles and blog posts can feed your presentation directly.
- Improved generation speed: first-time generation is over 30% faster, with multimodal vision added in more places so the AI can actually "see" pages and images.
- Improved source fidelity: slides generated from the outline keep the original text in full, so long documents no longer lose content.
- Improved content protection in AI edits: chat edits, beautification, and style switching preserve the original text and data more strictly.
- Improved failure retries: failed slides retry with their failure context, applying targeted fixes instead of full regeneration where possible.
- Improved PPTX import: fixed lost text and vector images, with better restoration of charts, text wrapping, and WordArt, so imported decks stay closer to the original.
- Improved style extraction on import: faster and more accurate, reusing the original cover as the style preview.
- Improved template and creative creation; all built-in styles now include real preview images for easier picking.
- Fixed preview images failing to display on Windows.
- Fixed incorrect generation durations shown on session cards.
- Fixed an exception-handling issue in the editor's AI mode.
- Fixed overlapping loading states during retries and other issues.

## 2026-08-09 · v2.3.0

### 中文

- 新增AI模式支持当前页参考文件上传，可将常用文档作为本次修改的参考（比如生成图表等等）。
- 新增一键配图：可为页面快速补充更合适的图片内容。
- 优化图片生成与配图体验，生成效果和使用流程更稳定。
- 优化编辑体验：拖拽、缩放与元素位置、尺寸调整更顺手。
- 优化 AI 创作与修改能力，预览和编辑过程更流畅。
- 优化一键美化效果，页面布局与视觉表现进一步提升。
- 优化生图模型的配置简单化，官网也新增完整的模型配置教程
- 优化可编辑 PPTX 导出效果。
- 修复ai模式的对话响应问题。

### English

- Added reference-file uploads for AI current-page edits, so common documents can guide the requested change.
- Added one-click image matching to quickly enrich slides with suitable visuals.
- Improved image generation and illustration workflows for more reliable results and a smoother experience.
- Improved editing: dragging, resizing, and adjusting element position and size are more intuitive.
- Improved AI creation and editing, with smoother preview and editing workflows.
- Improved one-click beautification for stronger slide layouts and visual presentation.
- Improved editable PPTX export results.

## 2026-08-03 · v2.2.0

### 中文

- 新增演示母版：可为整套演示统一设置背景、标题和正文字体，并按需覆盖已有页面，快速建立一致的视觉基调。
- 新增母版全局元素管理：可统一添加和调整 Logo、页脚、页码与水印，也可针对单页隐藏这些元素。
- 新增版式母版：可为封面、数据重点、对比、时间线、流程、总结等不同内容类型预设版式，后续新增或生成页面会更贴合预期结构。
- 新增创建时自动配图：选择支持生图的风格并开启功能后，系统会根据页面内容自动补充插画或背景图；失败页面可单独重试，不影响整套演示继续生成。
- 新增 AI 风格推荐：创建演示或选择风格时，可根据主题和内容获得匹配的风格建议，减少筛选成本。
- 新增更多内置风格，并在风格选择中清晰标记支持自动配图的风格。
- 新增帮助文档入口：可从侧边栏直接打开产品使用指南。
- 新增更多风格： 增加额外30+风格，支持配图等。
- 优化风格创建：官方 [style-generate-skill](https://github.com/arcsin1/style-generate-skill) 支持为风格配置配图方向，让使用该风格创作时的自动配图更贴合整体视觉。
- 优化 AI 生图体验：可在设置中验证生图模型，生成时提供更合适的尺寸选择与页面上下文参考，配图更容易融入当前页面。
- 优化一键美化：一键美化当前页面，在保留原有信息的同时优化页面的版式与视觉层次，效果极佳。
- 优化编辑体验：PPT 与网页编辑器中的元素选择、拖拽、缩放和属性调整更准确，复杂页面中的手动精修更顺手。
- 优化网页编辑：可继续编辑带有单页动画、切页或滚动效果的网页，并更好地保留当前页面状态。
- 优化 PPTX 导入与导出：进一步改善形状、字体、背景和动画等内容的还原；支持以 4:3 比例导出可编辑 PPTX。
- 优化 AI 修改流程：整套和指定页面的修改范围、进度反馈、取消与重试更清晰，避免无关页面受到影响。
- 优化 Windows 顶部工具栏，窗口操作更贴合桌面使用习惯。
- 修复主会话的进度展示与页面意图识别问题，AI 修改过程更稳定、反馈更准确。

### English

- Added Presentation Masters: set a shared background plus title and body fonts for an entire deck, then apply the visual direction across existing slides when needed.
- Added Global Elements: manage shared logos, footers, page numbers, and watermarks in one place, with the option to hide them on individual slides.
- Added Layout Masters: preset layouts for covers, data highlights, comparisons, timelines, processes, summaries, and more, so newly generated slides better match their intended structure.
- Added automatic illustrations during creation: choose an image-enabled style and turn the feature on to add context-aware illustrations or backgrounds as slides are generated. Failed illustrations can be retried without interrupting the deck.
- Added AI style recommendations: get matching style suggestions from your topic and content when creating a presentation or choosing a style.
- Added more built-in styles, with clear indicators for styles that support automatic illustrations.
- Added a Help Docs entry to the sidebar for direct access to the product guide.
- Improved style creation: the official [style-generate-skill](https://github.com/arcsin1/style-generate-skill) can now define illustration direction for a style, making automatic visuals better match the overall design.
- Improved AI image generation: verify image models from Settings, choose more suitable sizes, and generate with richer page context so visuals fit the current slide more naturally.
- Improved one-click beautification: choose visual or structure-focused refinement to improve layout and hierarchy while retaining the original information.
- Improved editing precision: selecting, dragging, resizing, and adjusting properties is more reliable in both the presentation and HTML editors, especially on complex pages.
- Improved HTML editing: continue editing pages with slide transitions, single-page animations, or scrolling effects while preserving the current page state more reliably.
- Improved PPTX import and export: better restoration of shapes, fonts, backgrounds, and animations, plus editable PPTX export in 4:3 format.
- Improved AI editing workflows: scope, progress, cancellation, and retries are clearer for full-deck and selected-slide changes, helping keep unrelated slides untouched.
- Improved the Windows title bar with desktop-friendly window controls.
- Fixed main-session progress reporting and page-intent recognition, making AI editing feedback more reliable.

## 2026-07-24 · v2.1.0

### 中文

- 新增 HTML 编辑功能：导入单HTML 文件后可在应用内直接编辑，保存，支持 AI 修改、素材添加、历史管理、预览和导出。
- 新增编辑页一键页面美化：自动优化当前页面的版式和视觉效果，同时保留原有文字与数据。
- 优化 PPTX 导入：升级独立的 `@arcsin1/pptx2json` 包，导入后的内容更接近原稿，也更方便继续编辑，大幅度优化导入效果，覆盖更多能力。
- 优化可编辑 PPTX 导出：升级独立的 `@arcsin1/html2pptx` 包，导出的文件更接近应用内的效果，大幅度优化导出效果，覆盖更多能力。
- 大幅优化整套风格切换交互：支持后台处理，切换过程中可继续使用应用，并可查看进度和重试失败页面，在后台独立运行。
- 大幅优化新增内容页交互：输入页面需求后可在后台生成新页面，沿用现有风格，生成状态和结果更清晰，在后台独立运行。
- 大幅优化编辑任务和界面反馈：页面修改与 PPTX 导出更稳定，会话、模板和用量查看更清晰，可重试，可中断，在后台独立运行。
- 大幅优化ai模式的交互：升级为更智能的ai对话，完全后台独立运行，执行中，可重试，可中断，在后台独立运行。
- 修复 Windows 本地资源加载问题。
- 修复文字颜色修改后点击编辑区外会恢复的问题。

### English

- Added HTML editing: import HTML files and continue working on them in the app with AI edits, media insertion, history, preview, and export.
- Added one-click slide beautification: automatically improve the current slide's layout and visual quality while keeping its text and data unchanged.
- Improved PPTX import: upgraded the standalone `@arcsin1/pptx2json` package so imported content stays closer to the original and is easier to continue editing.
- Improved editable PPTX export: upgraded the standalone `@arcsin1/html2pptx` package so exported files more closely match the in-app result.
- Significantly improved full-deck style switching: it now runs in the background, so you can keep using the app while tracking progress and retrying failed slides.
- Significantly improved content-slide creation: describe the page you need and generate it in the background using the presentation's existing style, with clearer progress and results.
- Improved editing reliability and interface feedback: page edits and PPTX export are more stable, while Sessions, Templates, and Token Usage are clearer to manage.
- Fixed Windows local-resource loading issues.
- Fixed an issue where text color changes could revert after clicking outside the editing area.

## 2026-07-12 · v2.0.20

### 中文

- 新增编辑页形状与图标插入：可直接添加矩形、圆角矩形、圆形、线条、箭头、三角形、菱形、星形等常用形状，以及图标和编号元素，做结构标注、流程图和重点提示更方便。
- 新增公式插入：编辑时可从工具栏快速添加 LaTeX 公式，并继续在右侧面板修改内容、展示方式和预览效果。
- 新增可编辑图表：支持插入柱状图、折线图、饼图、环形图和雷达图，可调整标题、数据、颜色、图例、堆叠、横向显示、平滑曲线和面积填充等设置。
- 新增图表数据导入：图表编辑面板支持导入 CSV、TSV、JSON 和 Excel 数据，分类列与数值列会自动整理为可编辑图表数据。
- 新增元素应用到所有页面：选中一个元素后可同步到整套演示，适合统一页眉页脚、Logo、角标、版权信息或固定装饰元素。
- 新增从模板添加页面：可在当前演示中选择模板页面并复制到末尾，保留模板原始页面风格，方便快速补页和复用版式。
- 新增复制页面：可直接复制当前页面并插入到原页之后，复制后保留页面内容、素材引用和编辑结构。
- 新增 PNG 长图导出：可将整套演示纵向拼接为一张长图，适合社媒发布、聊天分享和长文档预览。
- 新增升级可编辑 PPTX 导入底座：开源并重写了底层 PPTX 可编辑导入包（`@arcsin1/pptx2json`）的实现，新的解析链路改进形状、表格、图表、图片、文本层级和动画信息还原，导入后更接近原稿并更容易继续编辑（适用于所有pptx文件）。
- 优化 PPTX 导入进度：导入阶段会展示解析、写入会话、抽取风格和完成状态，长文件导入时等待感更清晰。
- 优化运行时播放与预览：刷新图表渲染和导入页面运行时资源，提升浏览、演示和导入页面回放的一致性。

### English

- Added shape and icon insertion in the editor: insert common shapes such as rectangles, rounded rectangles, ellipses, lines, arrows, triangles, diamonds, stars, plus icon and number elements for diagrams, annotations, and highlights.
- Added formula insertion: add a LaTeX formula from the toolbar, then continue editing its content, display mode, and preview from the inspector.
- Added editable charts: insert bar, line, pie, doughnut, and radar charts, then adjust titles, data, colors, legends, stacking, horizontal layout, smooth lines, and area fills.
- Added chart data import: the chart inspector can import CSV, TSV, JSON, and Excel data, mapping category and numeric columns into editable chart data.
- Added apply element to all pages: sync a selected element across the full deck, useful for headers, footers, logos, badges, copyright notes, and fixed decoration.
- Added pages from templates: choose pages from a template and copy them to the end of the current presentation while preserving the template's original page style.
- Added page duplication: duplicate the current page directly after the source page while preserving content, asset references, and editable structure.
- Added PNG long image export: stitch the full deck vertically into one long image for social posts, chat sharing, and long-document previews.
- Major upgrade to the editable PPTX import foundation: the underlying editable PPTX import package (`@arcsin1/pptx2json`) has been open-sourced and rewritten, with a new parser that improves restoration of shapes, tables, charts, images, text layering, and animation metadata so imported decks stay closer to the original and remain easier to edit.
- Improved PPTX import progress: import now reports parsing, session writing, style extraction, and completion states, making long imports easier to follow.
- Improved runtime playback and previews: refreshed chart rendering and imported-page runtime assets make browsing, presenting, and imported slide playback more consistent.

## 2026-07-06 · v2.0.19

### 中文

- 新增多尺寸创作：一套工具覆盖横屏演示、竖版长图、4:3 投屏、方图和小红书等多种场景，会话、模板、预览、导出全程保留真实比例，不再被拉伸裁切。
- 新增内置技能更贴近实际场景：多尺寸布局和图表生成规则更完整，模型调用更稳定，生成结果更少跑偏。
- 优化PPTX 导入更接近原稿：改进形状还原和颜色层级，减少圆形变椭圆、胶囊失真、文字偏位等问题。
- 优化长文档生成带章节结构：自动为适合的章节生成”本章概览”过渡页，长资料不再是逐页平铺，而是有节奏、有结构的演示叙事。
- 优化 Windows 顶部拖拽也更顺手。
- 修复编辑保存与交互细节：移动、改字、调整元素后更可靠地进入待保存状态，风格切换进度更清晰。

### English

- Multi-format canvas: create widescreen decks, vertical scrolls, 4:3 slides, square cards, and posters from one workspace — sessions, templates, previews, and exports keep the true proportions throughout.
- Long Markdown sources become structured decks: section hierarchy is recognized on import, and suitable chapters automatically get “chapter overview” transition pages, turning long material into a paced, readable presentation.
- PPTX import is closer to the original: improved shape fidelity and color/layer accuracy, reducing ovalized circles, distorted pills, and shifted text.
- Built-in skills are more production-ready: richer multi-format layout and chart guidance, with more stable model calls and fewer generation drifts.
- Fixed edit-save states and interaction details: moving, editing, or resizing elements now reliably triggers save state; style-switching progress is clearer; Windows toolbar dragging is smoother.

## 2026-06-28 · v2.0.18

### 中文

- 新增创建时动画风格选择（可选）：生成演示前可以先选择喜欢的动效动画方向，让整套演示从一开始就更接近想要的讲述节奏。
- 新增编辑页[动画]单个元素动画设置：编辑时可直接给文字、图片、图表等元素添加入场、强调或退出效果，适合做重点突出和逐步讲解。
- 新增数学公式编辑：选中公式后可直接修改内容、切换展示方式并实时预览，理工、金融、教育类演示更容易精修。
- 新增风格收藏：常用风格可以收藏，创建演示或切换风格时更快找到自己反复使用的视觉方案。
- 新增风格搜索：风格库和创建页风格选择器都支持搜索与场景筛选，面对大量风格时不用再一点点翻。
- 新增 Seedream 生图支持：图片生成可使用 Seedream，给需要配图、背景图和创意视觉的页面多一个选择。
- 新增更多模型兼容选项（thinking）：设置模型时可以更灵活地适配不同服务，减少“配置看起来没问题但实际无法调用”的情况。
- 新增了更多的内置动画：更多的动画内置，以及配置友好，单元素也可以配置不同动画。
- 修复【对话创作】偶发中断：AI 整理需求或生成大纲时，即使模型返回的内容结构略有差异，也会自动校正并继续处理，减少因格式不一致导致的失败(deepseek)。
- 优化【对话创作】上下文连续性：更新主题、确认事项和待解决问题时会保留未改动的信息，减少多轮沟通中需求或决定意外丢失。
- 优化手动编辑保存体验：移动、缩放、改字、删元素等操作会更清楚地进入待保存状态，切换页面前也会提醒，减少辛苦调整后丢失修改。
- 优化【编辑页】页面管理体验：页面排序、重命名、删除、单页导出和大纲导出更顺手，侧栏和浏览模式里的页面切换也更稳定。
- 优化风格查找体验：风格按适用场景重新整理，收藏、搜索和筛选结果更符合实际使用习惯。
- 优化【生成过程】后台生成体验：最小化应用后不会再被单页预览反复唤起，仅在整套演示生成完成或失败时恢复窗口提醒。
- 优化页面可读性：新生成页面会减少过小文字，标题、正文和注释更适合直接投屏或分享（正文最小18px，注释等不低于12px）。
- 优化元素选中和拖拽：复杂页面里选中文字、公式、图片和重叠元素更准确，拖拽对齐时也更不容易偏。
- 优化编辑历史稳定性：撤销、重做、历史回滚和继续编辑更稳，复杂会话里反复调整更安心。
- 增强 PPTX 动画保留效果：导入和导出时能更好保留常见动画，导出的可编辑 PPTX 在 PowerPoint/WPS 中播放更接近应用内效果。
- 增强图表页生成质量：图表会获得更合理的展示空间，旁边的结论、注释和指标也更克制，减少“图太小、卡片太多、重点不清”的页面。
- 增强复杂内容排版能力：生成时会更重视页面主次、信息密度和阅读路径，长内容更容易被整理成适合演示的结构（更关注内容密度来决定排版）。
- 增强动画生成质量：AI 生成的动画更贴近演示场景，减少看起来热闹但不利于讲述或导出后表现不一致的动画。

### English

- Added optional animation style choices during creation: pick the motion direction you want before generation so the whole deck starts closer to the pacing you have in mind.
- Added per-element animation controls: add entrance, emphasis, or exit effects directly to text, images, charts, and other slide elements in the editor — ideal for highlighting key points and walking through content step by step.
- Added formula editing: select a formula to revise its content, switch display style, and preview the result instantly, making it easier to fine-tune technical, finance, and education decks.
- Added style favorites: save frequently used styles and find them faster when creating a deck or switching styles.
- Added style search: both the style library and the creation-flow style picker now support search and scenario filtering, so you no longer have to scroll through large collections one by one.
- Added Seedream image generation support: use Seedream for slide visuals, backgrounds, and creative imagery, giving image-heavy pages one more option.
- Added more flexible model compatibility options (thinking): model setup adapts to more services, reducing cases where a config looks fine but actually fails to call.
- Added more built-in animations: more animations are now built in, with friendlier configuration.
- Fixed occasional interruptions in Chat to Create: when AI organizes requirements or builds an outline, minor structural differences in model responses (deepseek) are corrected automatically instead of stopping the workflow.
- Improved Chat to Create context continuity: when updating topics, confirmed decisions, or open questions, unchanged information is preserved, reducing accidental loss of requirements or decisions across multi-turn planning.
- Improved manual edit saving: moves, resizes, text changes, and deleted elements are now more clearly marked as pending work, and page switching reminds you to save — reducing the chance of losing careful adjustments.
- Improved page management in the editor: sorting, renaming, deleting, single-slide export, and outline export feel smoother, and page switching in the sidebar and browse mode is more stable.
- Improved style discovery: styles are reorganized by use case, so favorites, search, and filter results better match real creation habits.
- Improved background generation: minimizing the app no longer lets individual slide previews repeatedly bring it forward; the window returns only when the full deck completes or fails.
- Improved slide readability: newly generated pages avoid overly small text, making titles, body copy, and notes easier to present or share (body text minimum 18px, notes no smaller than 12px).
- Improved element selection and dragging: text, formulas, images, and overlapping elements are easier to target accurately on complex slides, and alignment while dragging is less likely to drift.
- Improved editing reliability: undo, redo, history rollback, and continued editing are steadier, making repeated adjustments in complex sessions more reassuring.
- Enhanced PPTX animation preservation: common animations are better retained on import and export, so editable PPTX files play closer to the in-app experience in PowerPoint / WPS.
- Enhanced chart-slide quality: charts get more appropriate space, while nearby conclusions, notes, and metrics stay more restrained — reducing slides where the chart is too small, there are too many cards, and the main point is unclear.
- Enhanced complex-content layout: generation pays more attention to hierarchy, information density, and reading flow, turning long material into more presentation-ready structures (layout is now decided more by content density).
- Enhanced animation quality: generated animations are more presentation-oriented, reducing flashy effects that distract from the message or behave inconsistently after export.

## 2026-06-16 · v2.0.17

### 中文

- 新增跨会话添加页面：编辑时可从其他已有会话中选择页面复制到当前演示末尾，适合复用历史内容、合并方案或快速拼接多份稿件。
- 新增主会话页面范围选择：对整套演示发起 AI 修改时，可选择全部页面或指定页面范围，避免一次改动影响不相关页面。
- 新增批量编辑进度面板：整套/多页修改会实时展示每页处理状态、失败原因和完成结果，失败页面可单独重试。
- 新增整套风格切换：可在编辑工作台中选择新风格并重绘整套演示，尽量保留原有文字、数据和页面含义，同时重新设计视觉布局。
- 新增编辑标尺、网格与辅助线：编辑画布支持吸附、参考线和标尺定位，拖拽排版、对齐元素和统一页面结构更方便。
- 新增会话搜索：会话列表支持按标题搜索，历史演示较多时更容易定位目标会话。
- 新增会话与模板封面缩略图生成：会话列表、模板卡片和风格预览的封面加载更完整，并支持缩略图缺失时自动补全。
- 新增 Token 用量统计：设置中可查看模型调用次数、输入/输出 Token、按天趋势、当天小时趋势和不同模型的用量分布（仅供参考）。
- 新增 OpenAI Responses Provider：基础模型配置可选择 OpenAI Responses 接口，兼容新的 OpenAI 调用链路。
- 新增 Linux 打包配置，可自行打包
- 新增风格包导入导出：支持导入风格 ZIP 或风格文件夹，也可将单个风格导出为 ZIP；风格页新增场景筛选、删除确认和官方风格解析 Skill 入口。
- 增强PPTX 导入：进一步改进表格、图表和页面结构解析，导入后的页面更容易继续编辑、生成缩略图和复用为风格。
- 重构：风格系统内置风格从 30+ 扩展到 70+，风格资源改为独立文件夹结构，风格生成skill用：官方技能包[https://github.com/arcsin1/style-generate-skill]。
- 优化 OpenAI 兼容模型参数处理：官方 OpenAI 端点不再携带非标准 `thinking` 参数，其他兼容端点仍会按需关闭 thinking，减少 `400 Unknown parameter` 和推理字段兼容问题。
- 优化所有页面的ui风格：所有页面都ui增强，支持预览缩略图以及交互增强。
- 优化页面生成与修改摘要：生成完成说明会基于已验证页面数据构建，编辑摘要会隔离模型原始输出，减少完成提示与实际页面状态不一致的问题。
- 优化会话列表 UI 与长列表渲染：页面缩略图按需加载，列表滚动和大量会话展示更顺畅，性能增强。

### English

- Added pages from another session: select slides from an existing session and copy them to the end of the current deck, making it easier to reuse previous work, merge proposals, or assemble decks quickly.
- Added page range selection for main-session AI edits: apply deck-level instructions to all slides or only selected slides, reducing accidental changes to unrelated pages.
- Added a batch edit progress panel: track the status, failure reason, and final result for each slide during whole-deck or multi-slide edits, with retry support for failed slides.
- Added full-deck style switching: choose a new style in the editor and redraw the whole presentation while keeping the original text, data, and slide meaning as much as possible.
- Added editor rulers, grids, and guides: snapping and reference lines make alignment, layout, and consistent slide structure easier.
- Added session search: search session titles from the session list to find older decks faster.
- Added cover thumbnail generation for sessions and templates: session lists, template cards, and style previews now show covers more completely, and missing thumbnails can be filled automatically.
- Added token usage statistics: view model call counts, input/output tokens, daily trends, today's hourly usage, and usage distribution by model from Settings.
- Added OpenAI Responses Provider: base model configuration can now choose the OpenAI Responses interface.
- Added Linux packaging configuration, so Linux builds can be packaged manually.
- Improved OpenAI-compatible model handling: official OpenAI endpoints no longer receive unsupported `thinking` parameters, while compatible endpoints still request thinking to be disabled when needed, reducing related configuration and call failures.
- Reworked the style system: built-in styles expanded from 30+ to 70+, with a new style resource structure. Use the official style generation skill at [https://github.com/arcsin1/style-generate-skill].
- Added style package import/export: import style ZIPs or style folders, export individual styles as ZIP files, filter styles by use case, confirm deletion, and open the official style parser skill from the Styles page.
- Improved the UI style across all pages: every page has enhanced visuals, preview thumbnails, and interaction details.
- Enhanced PPTX import: tables, charts, and slide structure are parsed more accurately, making imported slides easier to edit, thumbnail, and reuse as styles.
- Improved generation and edit summaries: completion messages are now based on confirmed slide results, and edit summaries avoid exposing raw model output, reducing mismatch between messages and actual slide state.
- Improved the Sessions page and long-list performance: slide thumbnails load as needed, scrolling through many sessions is smoother, and overall performance is better.

## 2026-06-11 · v2.0.16

### 中文

- 新增 MP4 视频导出功能：可将整套演示导出为视频文件，适合分享、归档或在不方便播放 PPT 的场景中直接使用。
- 新增页面切换动画：支持淡入、滑动、推进、擦除、缩放、翻转、立方体、封面流、模糊、聚焦展开等多种切页效果，演示节奏更接近正式放映（只在浏览器打开和演示模式有效）。
- 新增鼠标滚轮翻页：演示和浏览时可使用鼠标滚轮切换页面，翻页手感更自然，并减少连续滚动导致的误触。
- 新增导出进度提示：PPTX、图片和视频导出过程中会显示实时进度、当前阶段和完成结果，长文件导出时更安心。
- 增强 PPTX 导出质量：导出的可编辑 PPTX 对文字、图片、图表、表格、动画和页面结构的还原更稳定，复杂页面在 PowerPoint 和 WPS 中的表现更可靠（因为没有大量测试模版，不能做到100%还原，大概80%-95%效果）。
- 增强 PPTX 导出速度：长演示和复杂页面的导出等待时间减少，批量导出体验更顺畅。
- 增强 PPTX 导入：导入已有 PPTX 时可更好识别图表、表格和页面内容，导入后的页面更容易继续编辑和复用。
- 优化页面画布：生成页与预览页减少默认边距干扰，页面更接近真正的全屏幻灯片效果，背景和主体内容的边界更一致。
- 优化生成布局质量：AI 会先根据内容密度选择合适的版式，再进行宽高自检，减少内容超出画布、上下堆叠和卡片过密的问题，同时保留更自由的创意布局。
- 优化图表页面生成：图表页会更明确地区分主图表、辅助信息和注释，减少图表过高、信息区挤压或多行卡片堆叠的问题。
- 优化大纲与资料生成：当用户明确列出多个要点时，页面规划会更完整地保留这些重点，减少漏点、合并不当或结构偏移。
- 优化生成完成提醒：生成任务通知更清晰，完成、失败和部分完成状态更容易识别。
- 修复思考文档刷新异常：部分场景下思考内容不及时更新的问题已改善。

### English

- Added MP4 video export: export an entire presentation as a video for sharing, archiving, or playback when a PPT file is not the best fit.
- Added slide transitions: choose from fade, slide, push, wipe, zoom, flip, cube, cover flow, blur, iris, swing, and center reveal for a more presentation-ready rhythm.
- Added mouse wheel navigation: move between slides with the mouse wheel while browsing or presenting, with smoother control and fewer accidental jumps.
- Added export progress feedback: PPTX, image, and video exports now show live progress, the current stage, and the final result, making long exports easier to follow.
- Improved PPTX export quality: editable PPTX files now preserve text, images, charts, tables, animations, and slide structure more reliably, with better results in PowerPoint and WPS.
- Improved PPTX export speed: long presentations and complex slides now export with less waiting, making batch export smoother.
- Improved PPTX import: existing PPTX files now restore charts, tables, and slide content more accurately, so imported slides are easier to edit and reuse.
- Improved the slide canvas: generated and previewed slides now feel closer to true full-screen slides, with less default spacing around the canvas.
- Improved generated layout quality: AI now chooses layouts based on content density and checks width and height before writing, reducing overflow, vertical stacking, and overcrowded cards while keeping layouts more creative.
- Improved chart slide generation: chart pages now better separate the main chart, supporting information, and notes, reducing oversized charts, squeezed content, and stacked support cards.
- Improved outline and source-based generation: when users provide explicit points, slide planning preserves them more completely and reduces missing points, unwanted merging, or structural drift.
- Improved generation completion notifications: task updates are clearer, making completed, failed, and partially completed states easier to recognize.
- Fixed thinking document refresh issues in some sessions.

## 2026-06-07 · v2.0.15

### 中文

- 新增多任务生成：创建演示会话后可继续发起其他任务，无需停留在生成页面等待；会话列表会持续展示排队、生成进度和完成状态。
- 新增应用内任务通知：生成完成、部分完成或失败时会在应用内及时提醒，并可直接进入对应会话查看结果。
- 新增会话另存为：可复制当前演示的页面与素材创建独立新会话，适合保留原稿后继续制作不同版本。
- 新增浏览模式：在编辑工作台中以更纯净的方式连续查看整套演示，编辑、浏览和演示等使用场景切换更清晰。
- 新增艺术字：编辑页面可直接插入艺术字，并可以调整文案、效果和字号，标题与重点内容的视觉表现更丰富。
- 新增模型兼容性设置：基础模型配置支持关闭 `temperature` 参数，兼容不接受该参数的模型服务。
- 新增对话创作大纲编辑：可在生成前手动修改每页的标题、页面目标、内容摘要和关键要点，后续对话与生成会使用更新后的大纲。
- 大幅增强资料理解与大纲解析：上传 Markdown、文本、CSV、DOCX 或图片后，可更准确地提炼章节、关键结论、数据和页面结构，让生成内容更贴近原始资料。
- 增强对话创作：AI 能更持续地整理上传资料、创作目标和页面规划，在生成前形成更清晰、可调整的内容方案。
- 增强 PPTX 导入：支持更好地还原表格、图表、页面大纲和动画信息，复杂演示导入后的可编辑性与结构完整度进一步提升。
- 优化多模型任务执行：不同任务可分别选择运行模型，支持使用多个模型处理生成、编辑、模板复用、文档解析和演讲稿等任务。
- 优化编辑工作台：重新组织顶部工具、页面导航、AI、生图、属性、演讲稿和历史记录等功能，常用操作更集中，编辑状态更清晰。
- 优化编辑历史：撤销、重做和页面编辑记录更稳定，复杂编辑过程中的回退与恢复更可靠。
- 优化大文件与长演示支持：演示页数上限提升至 500 页，PPTX 上传大小上限提升至 500MB。
- 优化缩略图加载：长演示的页面缩略图按需加载，进入编辑页和滚动页面列表时更流畅。
- 优化模板创建与复用：文档解析建议、模型选择和生成参数确认更集中，使用模板创建新内容时更直观。
- 修复 macOS Apple Silicon 环境下部分会话包无法正常打开的问题。

### English

- Added multi-task generation: start another presentation while existing tasks continue in the background, with queued, generating, and completed states visible from the Sessions page.
- Added in-app task notifications: receive a notification when generation completes, partially completes, or fails, then open the related session directly.
- Added Save as New Session: duplicate the current slides and assets into an independent session, making it easier to preserve the original while creating variations.
- Added Browse mode: review the full presentation in a cleaner workspace, with clearer transitions between editing, browsing, and presenting.
- Added WordArt: insert stylized text directly in the editor and adjust its content, effect, and size for more expressive titles and highlights.
- Added a model compatibility option: Base Model Configuration can omit the `temperature` parameter for services that do not support it.
- Added outline editing in Chat to Create: revise each slide's title, objective, summary, and key points before generation; later conversations and generation use the updated outline.
- Significantly improved source understanding and outline parsing: Markdown, text, CSV, DOCX, and image uploads are now better organized into chapters, key findings, data points, and slide structures.
- Enhanced Chat to Create: AI now maintains a clearer understanding of uploaded sources, creative goals, and slide plans before turning them into a generation-ready outline.
- Enhanced PPTX import: tables, charts, slide outlines, and animation metadata are restored more accurately for better editability and structural fidelity.
- Improved multi-model task execution: different tasks can use different models for generation, editing, template reuse, document parsing, speaker scripts, and more.
- Improved the editing workspace: reorganized tools for page navigation, AI, image generation, properties, speaker scripts, and history so common actions are easier to find and current modes are clearer.
- Improved edit history: undo, redo, and slide edit records are more reliable during longer or more complex editing sessions.
- Improved support for large files and long presentations: presentations can now contain up to 500 slides, and PPTX uploads can be up to 500MB.
- Improved thumbnail loading: slide thumbnails are loaded on demand for smoother entry and scrolling in long presentations.
- Improved template creation and reuse: document suggestions, model selection, and generation settings are now presented in a more focused workflow.
- Fixed an issue that could prevent some session packages from opening on Apple Silicon Macs.

## 2026-06-02 · v2.0.14

### 中文

- 新增 AI 生图工作流：编辑页右侧新增图片生成模式，可围绕当前页面生成配图素材，并支持将生成图片添加到画布、设置为页面背景或直接定位本地文件。
- 新增多生图模型接入配置：目前支持即梦、Agnes AI、硅基流动、OpenAI-compatible 图片接口和 Gemini 图片生成，并可在设置页独立管理、启用和验证生图模型。
- 新增配图提示词辅助：支持「大纲提示词」和「风格提示词」，可根据当前页标题、大纲、页面视觉风格和用户输入生成更适合当前页面的配图描述；
- 新增统一模型切换体验：创建、模板复用、风格导入、图片解析等需要模型参与的操作，都可以在执行前选择本次使用的模型，减少频繁进入设置页切换的成本，多模型切换更方便。
- 新增页面大纲：编辑页支持读取、展示和编辑修改页面大纲，创建、导入、页面管理和单页补写流程中的页面上下文更清晰。
- 新增 HTTP/SOCKS 代理支持：可为模型服务配置代理，提升访问 Gemini 等外部服务时的网络兼容性。
- 新增 macOS Intel 架构支持配置，提升 Apple Silicon 与 Intel Mac 的安装包兼容性。
- 优化对话创作： 增加对话历史记录，用户可以查看和管理之前的对话记录，方便后续参考和继续创作。
- 优化设置页：增加一些配置帮助说明。
- 优化模板复用体验：从模板创建演示时的参数确认、模型选择和生成前校验更完整，减少模板结构异常导致的失败。
- 优化导入与解析稳定性：文档解析、大纲归一化、PPTX 导入和风格抽取流程更稳，对复杂输入的容错更好。
- 新增添加文字功能：编辑页可直接添加文字元素，文字编辑体验进一步优化。
- 优化编辑体验：改进文字选中、字体编辑、图层检查和元素锚点定位，减少重叠元素或复杂页面中的误选和编辑偏差。
- 优化技能提示词：更新图表与布局技能说明，生成图表、版式和页面结构时更贴合演示文稿场景。

### English

- Added AI image generation: create slide visuals from the editor, then add them to the canvas, set them as the slide background, or reveal the generated file locally.
- Added image model configuration: connect Jimeng, Agnes AI, SiliconFlow, OpenAI-compatible image APIs, and Gemini image generation from Settings.
- Added image prompt helpers: use "Outline prompt" and "Style prompt" to turn the current slide outline, visual style, and your own idea into a better image description.
- Added model selection at run time: choose which model to use before creation, template reuse, style import, image parsing, and other AI-powered actions.
- Added slide outlines: the editor can now read, display, and edit slide outlines, making the current slide context clearer during editing, import, page management, and single-slide regeneration.
- Added HTTP/SOCKS proxy support: configure a proxy for model services to improve connectivity with external providers such as Gemini.
- Added macOS Intel support: packaging configuration now better supports both Apple Silicon and Intel Macs.
- Improved chat-to-create: conversation history is now easier to keep, review, and continue from during creative planning.
- Improved Settings: added helpful configuration guidance.
- Improved template reuse: stronger parameter confirmation, model selection, and pre-generation checks reduce failures from invalid template structure.
- Improved import and parsing stability: document parsing, outline normalization, PPTX import, and style extraction now handle complex inputs more reliably.
- Added text insertion: add text elements directly in the editor, with further improvements to text editing.
- Improved editing: text selection, font editing, layer inspection, and element anchoring are more accurate on complex or overlapping slide elements.
- Improved built-in skill prompts: chart and layout instructions now better match presentation-generation scenarios.

## 2026-05-29 · v2.0.13

### 中文

- 新增动画效果增强：生成页面时支持更丰富的入场动画效果，包括淡入、飞入、擦除、缩放、旋转等，并支持逐条出现和交错展示，演示内容可按讲述节奏逐步展开。
- 新增 PPTX 动画导出：导出可编辑 PPTX 时保留动画效果和页面切换转场，导出后可在 PowerPoint或者wps中直接演示播放。
- 新增 PPTX 动画导入：导入 PPTX 时自动解析并还原原稿的动画效果，无需手动重新设置。
- 新增富文本编辑：编辑文字时可使用加粗、斜体、下划线、颜色和字号等格式，编辑体验更接近专业文档工具。
- 优化元素选中精度：点击重叠或嵌套元素时能更精准地定位到目标文字，不再被上层元素遮挡或误选。
- 优化生成质量：页面布局、图表和动画的生成效果更稳定，版式更合理、图表更准确、动画更自然。
- 优化更新提醒：新版本通知改为弹窗，可查看版本对比、选择下载方式和查看更新日志。
- 优化创建防重复提交：创建演示稿时防止重复点击导致创建多个会话。

### English

- Added animation enhancements: generated slides now support richer entrance animations including fade, fly-in, wipe, zoom, and spin, with staggered reveals and click-by-click display so content unfolds with the speaker's rhythm.
- Added PPTX animation export: exported editable PPTX files now preserve animation effects and slide transitions, playable directly in PowerPoint.
- Added PPTX animation import: imported PPTX files now automatically parse and restore the original animation effects, no manual setup needed.
- Added rich text editing: edit text with bold, italic, underline, color, and font size formatting for a more professional editing experience.
- Improved element selection precision: clicking overlapping or nested elements now accurately targets the intended text, no longer blocked or misdirected by upper-layer elements.
- Improved generation quality: slide layout, charts, and animations are more stable and accurate with better composition and more natural motion.
- Improved update notification: new version alerts now appear as a dialog with version comparison, download options, and changelog link.
- Improved session creation guard: prevents duplicate sessions from accidental double-clicks.

## 2026-05-27 · v2.0.12

### 中文

- 新增模板库：支持将已生成或已编辑的演示保存为模板，管理模板名称、描述和标签，并在模板页统一预览、编辑、删除和复用。
- 新增从模板创建ppt会话：可直接复用模板生成可编辑会话，也可输入新主题/大纲或上传文档解析后，沿用模板视觉系统重新生成内容。
- 新增 PPTX 文件可导入为模板：模板页可导入 `.pptx` 作为模板，自动解析页面、抽取视觉风格并生成模板设计契约。
- 新增页面标题编辑：编辑页支持修改单页标题。
- 新增空白页创建：可选择已有页面作为版式基础创建到末尾，并自动清空可见文字，适合快速延展同风格页面。
- 优化首页 PPTX 快速导入编辑入口：首页可直接导入 `.pptx` 创建可编辑会话，并展示导入进度和提示信息。
- 优化编辑/检选体验：进入编辑和 AI 检选时会结束残留动画，避免带动画页面出现元素隐藏、停在半透明状态或无法选中的问题。
- 优化视频元素编辑与播放：可以对视频元素进行编辑，包括调整播放速度、音量、循环播放、自动播放等。
- 优化导入与运行时稳定性：会话导入更好地兼容扁平 ZIP 和复杂压缩包，导入会话补齐默认设计契约；
- 修复图表问题：图表类目轴bug、横向柱状图 tooltip 和 0 值数据展示更准确。
- 修复页面管理问题：修复页面管理时的动画问题，避免页面切换时元素隐藏、停在半透明状态或无法选中的问题。

### English

- Added Template Library: save generated or edited presentations as templates, manage template names, descriptions, and tags, then preview, edit, delete, and reuse them from the Templates page.
- Added PPT session creation from templates: reuse a template to create an editable session directly, or enter a new topic/outline or upload a document to regenerate content while keeping the template's visual system.
- Added PPTX import as templates: import `.pptx` files from the Templates page, automatically parse slides, extract the visual style, and create a template design contract.
- Added page title editing: edit individual slide titles from the editor.
- Added blank page creation: choose an existing slide as the layout base, create a new page at the end of the deck, and clear visible text for fast same-style page expansion.
- Improved the quick PPTX import editing entry on Home: import a `.pptx` directly from the Home page to create an editable session with progress and warning feedback.
- Improved edit and inspect modes: residual animations are finished before editing or AI inspection, reducing hidden, half-transparent, or hard-to-select elements on animated slides.
- Improved video element editing and playback: video elements can now be edited, including playback speed, volume, loop playback, autoplay, and more.
- Improved import and runtime stability: session import better handles flat ZIPs and complex archives, and imported sessions receive a default design contract.
- Fixed chart issues: category-axis bugs, horizontal bar chart tooltips, and zero-value data now render more accurately.
- Fixed page management issues: resolved animation problems during page management, reducing hidden, half-transparent, or hard-to-select elements when switching pages.

## 2026-05-24 · v2.0.11

### 中文

- 新增对话创作模式：先通过多轮对话梳理主题、资料、受众、结构和每页重点，再确认参数生成完整演示稿。适合需求尚不清晰、资料较复杂或需要先共同推敲大纲的场景，再去生成创作。
- 新增演讲稿创作：支持为整套幻灯片或当前页生成演讲稿，内置正式演讲、轻松对话、叙事风格和自定义风格，并可复制或直接查看文件。
- 新增 Gemini Provider：设置页支持配置 Google Gemini，可用于生成、编辑和对话创作。
- 重构动画系统：支持更自然的入场动画、错峰展示和点击逐条出现，让演示内容可以按讲述节奏逐步展开。
- 优化演示播放：键盘导航、鼠标点击和逐条展示的衔接更顺畅，带点击节奏的页面不容易误翻页。
- 优化预览与导出稳定性：带动画、图表和复杂内容的页面在预览、缩略图和导出时显示更可靠。
- 优化生成预览： 生成的时候支持边生成边预览，无需等待生成完成，方便确认生成效果。

### English

- Added Chat to Create: first use a multi-turn conversation to clarify the topic, materials, audience, structure, and key points for each slide, then confirm the parameters and generate the full presentation. It is designed for unclear requirements, complex materials, or scenarios where you want to shape the outline together before creation.
- Added speaker script creation: generate scripts for the full deck or the current slide, with built-in formal, casual conversational, storytelling, and custom styles. Scripts can be copied or opened directly as a file.
- Added Gemini Provider: Google Gemini can now be configured in Settings and used for generation, editing, and Chat to Create.
- Rebuilt the animation system: supports more natural entrance animations, staggered reveals, and click-by-click content display, so presentation content can unfold with the speaker's rhythm.
- Improved presentation playback: keyboard navigation, mouse clicks, and step-by-step reveals now work together more smoothly, making click-paced pages less likely to accidentally advance to the next slide.
- Improved preview and export stability: slides with animations, charts, and complex content now render more reliably in previews, thumbnails, and exports.
- Improved generation preview: slides can now be previewed while they are still being generated, so you no longer need to wait for the full generation to finish before checking the result.

## 2026-05-18 · v2.0.10

### 中文

- 新增元素属性面板：选中元素后可独立调整文字样式（字号、粗细、颜色）、外观（背景色、边框、圆角、阴影）、布局（尺寸、位置）、图层（层级、可见性）和媒体属性，编辑更精细。
- 新增取色器：颜色选择支持自定义取色板和透明度调节，编辑颜色更灵活直观。
- 新增导出会话文件：编辑页面一键导出会话生成的创意 PPT，另一台电脑导入后可继续二次编辑，跨设备协作无缝衔接。
- 新增导入会话文件：会话列表支持导入slide-pack 打包的文件或标准会话 ZIP，导入后可继续二次编辑。
- 新增编辑页面历史记录：编辑模式下自动记录操作历史，支持在保存版本前浏览和回退到任意编辑步骤。
- 新增字体数据回填：升级后自动为已有会话补充字体信息，兼容历史数据。
- 优化生成成功率：大幅提升页面生成的稳定性和成功率，减少生成失败和格式异常，增加兜底策略，减少token消耗。
- 优化生成引擎：改进大纲规划与页面写入逻辑，生成结果更完整、布局更合理。
- 优化编辑交互：元素选中和拖拽体验更流畅，编辑模式整体更稳定。
- 修复风格预览bug： 兼容win下的风格预览问题，展示更直观。

### English

- Added element inspector panel: select any element to independently adjust text styles (size, weight, color), appearance (background, border, radius, shadow), layout (size, position), layers (z-index, visibility), and media properties for more precise editing.
- Added color picker: custom color palette with transparency control for more flexible and intuitive color editing.
- Added session file export: one-click export of your AI-generated creative deck from the editing page — import it on another computer to continue editing, making cross-device collaboration seamless.
- Added session file import: import slide-pack files or standard session ZIPs from the session list and continue editing.
- Added edit history: edit mode automatically tracks changes, allowing you to browse and revert to any step before saving a version.
- Added font data backfill: automatically supplements font info for existing sessions after upgrade for backward compatibility.
- Improved generation success rate: significantly more stable page generation with fewer failures and format issues, added fallback strategies, and reduced token consumption.
- Improved generation engine: better outline planning and page writing logic for more complete results and layouts.
- Improved editing interaction: smoother element selection and dragging, with a more stable edit mode overall.
- Fixed style preview: resolved Windows compatibility issues for a more intuitive preview experience.

## 2026-05-17 · v2.0.9

### 中文

- 新增字体管理：内置 14 款精选 Google 字体（含中文），支持上传本地 .woff2 字体，可自定义字体名称、分类、用途和语言类型。
- 新增字体选择：创建演示稿时可分别指定标题字体和正文字体，也可交给 AI 根据主题和风格自动匹配。
- 新增字体嵌渲染实质化：导出 PPTX 时自动嵌入已使用的字体文件，确保在 PowerPoint 中打开后字体不丢失、不回退。
- 新增风格缩略图：风格列表展示可视化预览缩略图，挑选风格更直观。
- 新增模型 Max Tokens 设置：可在设置中自定义模型最大输出长度，适配不同模型的响应上限。
- 新增 Windows 系统托盘：关闭窗口后应用最小化到系统托盘，后台运行不干扰桌面。
- 优化风格管理：整体风格编辑和展示体验更流畅，显示风格的适用场景。
- 优化内置风格： 重写内置风格的提示词和style_skill。
- 优化 PPTX 导出：导出流程和效果持续改进（暂不支持视频导出以及动画导出，html的复杂度导致导出无法完全一样）。
- 优化文字大小：优化生成默认最小文字为16px，更适合ppt风格的预览和演示。
- 修复：演示模式和本地预览的键盘鼠标bug
- 修复：Windows 11 下批量导出图片失败的问题。
- 修复：修复默认导出目录不正确的问题。

### English

- Added font management: 14 curated Google Fonts built-in (including CJK), with support for uploading local .woff2 fonts and customizing name, category, role, and script.
- Added font selection: choose title and body fonts separately before generation, or let AI auto-match based on topic and style.
- Added font embedding in PPTX export: used fonts are automatically embedded in the exported file so they display correctly in PowerPoint without fallback.
- Added style thumbnails: the style list now shows visual preview thumbnails for easier selection.
- Added Max Tokens setting: customize the model's maximum output length in Settings to match different model limits.
- Added Windows system tray: closing the window minimizes the app to the system tray instead of quitting.
- Improved style management: smoother editing and browsing experience, with applicable scenarios shown for each style.
- Improved built-in styles: rewrote prompts and style skills for all built-in styles.
- Improved PPTX export: further refinements to the export pipeline and output quality.
- Improved minimum font size: default minimum text size is now 16px for better readability in previews and presentations.
- Fixed keyboard and mouse issues in presentation mode and local preview.
- Fixed batch PNG export failing on Windows 11.
- Fixed incorrect default export directory.

## 2026-05-15 · v2.0.8

### 中文

- 优化数学公式导出：可编辑版 PPTX 中，公式以截图形式作为独立图片插入，确保在 PowerPoint 中正确显示。
- 优化背景截图：导出时自动隐藏已截图的公式元素，避免公式重复出现在背景中。
- 新增： 一键打包当前的html pptx为单个可执行文件（类似 PPTX），随时随地双击即可打开预览，无需安装任何软件（你有浏览器就行）。

### English

- Improved math formula export: formulas are captured as individual images in editable PPTX for correct display in PowerPoint.
- Improved background capture: already-captured formula elements are hidden during background screenshot to avoid duplication.
- Added one-click HTML pack: bundle the current HTML presentation into a single executable file — double-click to open and present anywhere, no installation needed (just a browser).

## 2026-05-14 · v2.0.7

### 中文

- 新增以及重写可编辑 PPTX 导出引擎：能导出80%-90%pptx效果（缺动画，某些元素还在优化中）。
- 新增背景图导出为图片版 PPTX：每页截图作为整页背景图，兼容性最佳。
- 新增演示模式键盘翻页：支持上下键翻页以适配演讲笔
- 修复演示模式/浏览器预览模式 ESC 退出问题。

### English

- Added and rewrote editable PPTX export engine: achieves 80–90% visual fidelity (no animation support yet; some elements still being refined).
- Added image-based PPTX export: each slide is captured as a full-page background image for maximum compatibility.
- Added arrow key navigation in presentation mode: supports up/down keys for presenter remotes.
- Fixed ESC not exiting presentation / browser preview mode.

## 2026-05-14 · v2.0.6

### 中文

- 新增复制元素：编辑模式下可复制任意元素，复制的元素自动偏移并独立可编辑。
- 新增可以添加图片和视频的功能：用户可以在编辑模式下直接上传图片和视频文件（存在本地资源目录的）。
- 新增操作内可以撤销和重做功能：用户可以在操作内撤销和重做操作，方便回退和恢复，最后再保存为版本纪录。
- 新增可以删除任意元素的功能：用户可以在编辑模式下，删除任意元素（文字、图片、视频等），支持快捷键。
- 新增演示模式：支持直接进入全屏演示播放，键盘左右键或点击切换页面。
- 优化编辑模式稳定性：整体编辑、拖拽、保存和复制的体验更可靠。
- 优化页面编辑稳定性：用户可以在页面编辑模式下，更稳定地进行全局修改和局部修改。
- 优化左侧边栏可以折叠：用户可以在编辑模式下，折叠左侧边栏，更方便操作。

### English

- Added element duplication: copy any element in edit mode; copies are auto-offset and independently editable.
- Added image and video insertion: upload images and videos directly in edit mode (stored in local assets directory).
- Added undo and redo: undo and redo edits before committing, then save as a version history entry.
- Added element deletion: delete any element (text, images, videos, etc.) in edit mode, with keyboard shortcut support.
- Added presentation mode: enter fullscreen presentation directly, navigate slides with arrow keys or clicks.
- Improved edit mode reliability: overall editing, dragging, saving, and copying are more stable.
- Improved page editing stability: global and partial edits are more reliable in page edit mode.
- Improved collapsible sidebar: the left sidebar can now be collapsed in edit mode for more workspace.

## 2026-05-11 · v2.0.5

### 中文

- 新增页面支持拖拽排序调整位置功能
- 新增可以删除页面的功能
- 优化历史版本体验：让历史列表更像一条清楚的创作时间线（增加更多操作日志记录）。
- 优化回退体验：回退到历史版本后，页面列表、页面顺序和预览内容更稳定。
- 优化老会话体验：从旧版本创建或切换过输出目录的会话，在预览、编辑、回退时更稳定。
- 优化页面编辑稳定性：单页编辑、全局修改和局部修改更稳，系统会更主动地修正不完整的编辑结果。
- 优化生成和编辑的错误提示：用户看到的是可理解的进度和失败提示。
- 优化导入和历史会话编辑：PPTX 导入会话和历史会话在继续编辑时更稳定。
- 优化风格表达：生成结果更强调情绪、叙事和表达，更加感性。

### English

- Added drag-and-drop page reordering.
- Added page deletion.
- Added history entries for page deletion.
- Improved the version history experience so the timeline reads like a clear creation story.
- Improved rollback reliability so the page list, page order, and preview stay consistent after reverting.
- Improved older sessions created in previous versions or sessions affected by output directory changes, making previewing, editing, and rollback more stable.
- Improved edit reliability for single-slide edits, deck-wide edits, and element-level edits, with more proactive recovery for incomplete edit results.
- Improved error messages for generation and editing so users see clear progress and understandable failures.
- Improved continuing edits for PPTX-imported sessions and historical sessions.
- Improved style expression so results feel more emotional, narrative, and expressive.

## 2026-05-09

### 中文

- 新增图片解析创建：首页上传图片（png/jpg/jpeg/webp）后，系统自动从图片内容生成演示提纲，同时提取视觉风格并保存为自定义风格 Skill，创建表单一键回填。
- 新增图片导入风格：风格编辑页支持直接导入图片，自动提取配色、字体、版式、组件等视觉规则并回填表单。
- 新增版本历史：每次生成或编辑自动记录历史版本，支持查看和回退到任意历史版本，即使改错也能回退到之前版本。
- 新增主会话编辑：主会话现在可以统一修改一个或多个页面，不再仅限于单页编辑，即使改错也能回退到之前版本。
- 新增视频素材插入：会话详情页支持上传 mp4/webm/ogg 视频素材，并可在页面编辑中引用本地视频路径插入到指定位置。
- 优化编辑稳定性：页面编辑和主会话编辑进入自动修复阶段，遇到页面校验失败时会带错误信息自动重试一次，减少坏页面和手动重试。
- 优化删除提示：会话列表删除和历史版本回退等操作改为弹窗二次确认。

### English

- Added image-based creation and image style import.
- Added version history and main-session editing.
- Added video assets for page edits (mp4/webm/ogg).
- Improved edit reliability with one automatic retry after page validation failures.
- Improved delete and rollback confirmations.

## 2026-05-08

### 中文

 - 新增风格提取：导入文件或 PPTX 后，自动提取配色、字体和布局风格，保存为独立的风格 Skill。
 - 优化 PPTX 导入：导入 PPTX 后自动提取原稿视觉风格Skill保存到系统中，新增页面时自动继承原 PPTX 的配色、字体和布局。

### English

- Added style extraction: imported files and PPTX presentations automatically have their visual style extracted and saved as a reusable Style Skill.
- Improved PPTX import: newly added pages now inherit the imported PPTX's original colors, typography, and layout.

## 2026-05-07

### 中文

 - 新增编辑页：可以新增页面，每个页面可以包含多个元素。
 - 优化pptx：优化了导出pptx的流程，支持更多pptx的元素导出。
 - 优化性能： 优化整个应用的性能和稳定性。

### English

- Added page insertion: add new pages to an existing deck, each supporting multiple elements.
- Improved PPTX export: refined the export pipeline to support a wider range of PPTX elements.
- Improved performance: overall app performance and stability improvements.

## 2026-05-06

### 中文

- 新增文字编辑：双击选中页面文字后可直接修改内容和样式，修改结果实时同步到页面。
- 新增生成取消：创意生成过程中可随时取消。
- 优化检选模式：选中元素后的操作更精准，修改体验更顺畅。
- 优化编辑模式：完善单页编辑流程，编辑结果更稳定。
- 优化生成进度：底部新增阶段指示（准备 → 规划 → 生成 → 校验），实时显示页面完成进度。
- 优化生成日志：日志更简洁，只保留关键进度和结果，减少刷屏。
- 优化生成速度和稳定性：整体生成速度提升约 20%-40%，提升模型的生成成功率，单页编辑响应更快。
- 优化会话列表：显示每次生成的耗时，方便对比不同配置的生成效果。

### English

- Added text editing: select text on a slide to edit content and styling directly, with changes synced in real time.
- Improved element selection: selecting and modifying elements is more precise and fluid.
- Improved editing mode: refined the single-slide editing workflow for more reliable results.
- Improved generation progress: a new step indicator (Prepare → Plan → Generate → Validate) shows the current stage and real-time page count.
- Improved generation logs: cleaner log output showing only key milestones and results.
- Improved generation speed: overall generation is approximately 20–40% faster, with quicker single-slide edits.
- Improved generation reliability: enhanced page-write validation with automatic retries on failure.
- Added generation cancellation: cancel an in-progress generation at any time.
- Improved session list: generation duration is shown for each session.

---

## 2026-05-01

### 中文

- 新增多模型列表管理：可以在设置中添加多个模型，并把常用模型设为默认模型，随意切换模型（Breaking change）。
- 优化生成稳定性： 生成的稳定性得到了显著提升，减少了直接失败的情况。
- 优化错误提示：设置和生成相关提示会跟随当前界面语言显示中文或英文。
- 优化生成页日志：日志面板滚动更稳定，连续生成时更容易看到最新进度。
- 优化pptx导出：对于pptx导出进一步做优化策略，进一步提升导出效果（未引入ocr识别）。

### English

- Added multi-model list management: add multiple models in Settings, choose a default model, and switch between models freely.
- Improved generation stability: generation is noticeably more reliable, with fewer cases that fail outright.
- Improved error messages: Settings and generation errors now follow the current interface language.
- Improved generation logs: the log panel scrolls more reliably and keeps the latest progress easier to see.
- Improved PPTX export: added further export optimizations without introducing OCR.

---

## 2026-04-30

### 中文

- 优化页面调整体验：一切皆可拖拽，现在可以直接拖拽和缩放，调整文字、图片、公式、列表、数据标签和图表更顺手。
- 优化调整保存流程：页面调整不会立即保存，可连续微调多个元素后统一确认，也可以退出并放弃本次调整。
- 优化 AI 生成版式：页面标题和内容布局更灵活，生成结果不再局限于固定的顶部标题模板。
- 优化图表展示效果：坐标轴、提示信息和数据标签更清爽，减少过长数字和图表显示异常。
- 新增中英文界面语言：应用界面可切换中文或英文，生成内容仍会根据用户输入和资料自行判断语言。
- 优化生成进度展示：进度日志更简洁统一，减少重复、混杂或过度解释的状态信息。
- 优化页面版式延续性：生成、编辑和重试时会更好地延续每页原本的内容结构和视觉方向。
- 优化模型设置体验：常用模型配置更清晰，高级超时参数独立收纳，适合本地模型或响应较慢的模型按需调整。
- 优化会话详情页体验：顶部工具、预览标题、右侧消息面板和整体圆角更克制，界面层次更清爽。
- 优化图表生成稳定性：减少图表高度异常、被压缩或显示不完整的问题。

### English

- Improved slide adjustment: more slide content can now be moved and resized directly, making text, images, formulas, lists, data labels, and charts easier to refine.
- Improved the adjustment flow: layout edits are no longer saved immediately, so users can make several changes and then confirm or discard them together.
- Improved AI-generated layouts: titles and content placement are more flexible, moving beyond a fixed top-title template.
- Improved chart presentation: axes, tooltips, and data labels are cleaner, with fewer overly long numbers and fewer visual glitches.
- Added Chinese and English interface languages: the app UI can switch languages while generated content still follows the user's prompt and source materials.
- Improved generation progress: progress logs are cleaner and more consistent, with less repetition and fewer overly verbose status messages.
- Improved slide layout continuity: generation, editing, and retries now better preserve each slide's content structure and visual direction.
- Improved model settings: common model fields are easier to scan, while advanced timeout controls are tucked away for slower or local models.
- Improved the session detail experience: toolbar buttons, preview titles, the message panel, and overall corner radii now feel more restrained and easier to read.
- Fixed duplicate messages during single-slide editing: current-slide edits now show a cleaner, more stable conversation flow.
- Improved chart stability: reduced cases where charts appear compressed, clipped, or lose their intended height.

---

## 2026-04-29

### 中文

- 新增 PPTX 导入：可把本地 PPTX 转成应用内可编辑的演示稿，再继续预览、调整和对话修改。
- 优化从文档创建演示：上传文档后会更稳定地整理主题、页数和详细描述，大纲页数会更贴近实际内容。
- 新增数学公式渲染：生成的页面可直接显示常见 LaTeX 公式，导出时也会尽量保留公式效果。
- 优化可编辑 PPTX 导出：减少文字重叠问题，提升中英文混排和公式页面的导出效果。
- 优化首页入口：文档解析和 PPTX 导入入口更清晰，并提示本地文档只会在本机处理。
- 优化会话列表：可区分 AI 创建和 PPTX 导入的演示稿，并支持修改演示稿名称。

### English

- Added PPTX import: convert local PPTX files into editable in-app presentations for previewing, positioning, and chat-based editing.
- Improved document-based creation: uploaded documents now produce more reliable topics, page counts, and descriptions, with outlines that better match the content.
- Added math formula rendering: generated pages can display common LaTeX formulas, and exports try to preserve formula visuals.
- Improved editable PPTX export: reduced text overlap and improved mixed Chinese/English and formula-heavy slides.
- Improved the Home page: document parsing and PPTX import are easier to find, with clearer local-document privacy messaging.
- Improved the session list: imported PPTX sessions are easier to identify, and presentation names can be renamed.

---

## 2026-04-28

### 中文

- 新增页面元素拖拽调整：在预览中开启“调整位置”后，可直接拖拽带结构标识的页面模块并保存位置。
- 新增从文档创建演示：可上传 txt、md、csv、docx 文档，自动整理主题、页数和详细描述。
- 补充动画能力文档：说明基于 Anime.js v4 的基础整元素动画，并加入示例 GIF。
- 优化文档生成体验：上传较长文档后，每页内容会更贴近原文对应部分，生成速度和稳定性更好。
- 优化 OpenAI 兼容模型体验：默认关闭 thinking，减少文档解析、工具调用和重试生成时的兼容报错。
- 优化会话详情页结构：拆分页面侧栏、预览区、顶部工具栏和消息面板。

### English

- Added drag-to-position editing: enable Adjust Position in preview to drag structured page blocks and persist their layout.
- Added document-based creation: upload txt, md, csv, or docx files to automatically prepare the topic, page count, and description.
- Added animation documentation: describes basic Anime.js v4-powered whole-element animations with an example GIF.
- Improved document-based creation: pages now stay closer to the relevant parts of long uploaded documents, with better speed and stability.
- Improved OpenAI-compatible model behavior: thinking mode is disabled by default to reduce compatibility errors during document parsing, tool calls, and retry generation.
- Improved the session detail architecture: split the page sidebar, preview stage, top toolbar, and message panel, and added a page-level UI store for local state.

---

## 2026-04-27

### 中文

- 新增版本提醒：应用启动后会检查 GitHub Releases，如有新版本会提示用户前往下载。
- 优化生成恢复逻辑：应用意外或者退出后，可以根据已完成页面继续恢复进度。
- 优化失败处理：全部失败时提示重新生成；部分完成时提示继续生成剩余页面。
- 优化重试链路：只重试未完成页面，并保留用户补充说明。
- 优化编辑稳定性：编辑时会校验页面结构，避免坏页面被误标记为完成。
- 优化模型配置：生成与编辑统一使用系统设置中的最新模型配置。
- 优化模型稳定性：增强大纲规划与 JSON 输出解析，减少弱模型或本地模型格式异常导致的失败。
- 新增可编辑 PPTX 导出：尽量保留文字、图片、颜色与基础布局，方便在 PowerPoint / Keynote 中继续编辑。
- 新增批量 PNG 导出：一键将当前 deck 的所有页面导出为图片。
- 优化 PDF / PNG / PPTX 导出稳定性：导出时尽量使用静态页面状态，减少动画对输出结果的影响。
- 优化页面生成约束：生成时按固定 16:9 画布和内容高度预算组织页面，减少元素超出画布的问题。
- 优化 README 文档：补充多格式导出说明，并完善 macOS / Windows 未签名应用打开指引。

### English

- Added update notifications: the app checks GitHub Releases on startup and lets users open the release page when a newer version is available.
- Improved generation recovery: progress can be restored from completed pages after an unexpected app exit.
- Improved failure handling: fully failed sessions prompt regeneration, while partially completed sessions can continue remaining pages.
- Improved retry flow: only unfinished pages are retried, and user retry notes are preserved.
- Improved edit stability: page structure is validated before marking edits as completed.
- Unified model settings: generation and editing now always use the latest model configuration from Settings.
- Improved model stability: outline planning and JSON output parsing are more tolerant of malformed local/weak-model responses.
- Added editable PPTX export: preserves text, images, colors, and basic layout where possible for continued editing in PowerPoint / Keynote.
- Added batch PNG export: export every slide in the current deck as images with one click.
- Improved PDF / PNG / PPTX export stability: exports use a static slide state where possible to reduce animation-related output issues.
- Improved generation layout constraints: slides now follow a fixed 16:9 canvas and content-height budget to reduce overflow.
- Updated README docs: added multi-format export notes and clearer macOS / Windows unsigned-app instructions.

---

## 2026-04-26

### 中文

- 支持通过一句话生成本地 HTML 幻灯片。
- 支持逐页预览、演示模式和键盘切换。
- 支持对话式修改当前页内容。
- 支持检选页面元素后精准修改。
- 支持图片素材上传到本地会话目录并在编辑时引用。
- 支持一键导出 PDF。
- 新增风格管理，可查看、编辑和新增风格 Skill。
- 优化生成页动画、缩略图列表、预览画布和右侧 AI 面板体验。
- 补充 Ollama / OpenAI 兼容模型使用说明。
- 补充 macOS 与 Windows 未签名应用打开说明。

### English

- Added one-prompt local HTML slide generation.
- Added page-by-page preview, presentation mode, and keyboard navigation.
- Added chat-based editing for the current page.
- Added element inspection for more precise edits.
- Added local image asset uploads for use during page editing.
- Added one-click PDF export.
- Added style management for viewing, editing, and creating style skills.
- Improved the generation animation, thumbnail list, preview canvas, and AI message panel.
- Added usage notes for Ollama / OpenAI-compatible models.
- Added notes for opening unsigned macOS and Windows builds.
