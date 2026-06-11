<div align="center">
  <img src="thumb.png" alt="Oh My PPT" width="200" />
  <br/>
  <br/>

![AI PPT Generator](https://img.shields.io/badge/AI%20PPT-Generator-2f6d49)
![Local-first](https://img.shields.io/badge/Local--first-Private-3b7a57)
![License](https://img.shields.io/badge/license-Apache--2.0-green)
![Electron](https://img.shields.io/badge/Electron-Desktop-47848f)
![React](https://img.shields.io/badge/React-App-61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)

**Oh My PPT - 纯本地 AI PPT生成与编辑工具**

[English](./README_EN.md) | [为什么做这个](#why) • [能做什么](#features) • [使用流程](#workflow) • [更新日志](./CHANGELOG.md) • [使用问题](#usage-notes)

  <p>
    Describe what you need — a presentation, lesson, or story —<br/>
    and let the AI build clean, beautiful HTML slides for you.<br/>
    Local-first · Works offline, works for you.
  </p>

   [官网](https://www.ohmyppt.cc) | [下载安装包](https://github.com/arcsin1/oh-my-ppt/releases)

  <img src="https://arcsin1.github.io/ppt2.gif" alt="Oh My PPT" width="600" />

</div>

---

## 目录

- [为什么做这个](#why)
- [能做什么](#features)
- [使用流程](#workflow)
- [内置 30+ 风格 Skill](#style-skills)
- [字体管理](#fonts)
- [动画支持](#animations)
- [支持本地 Ollama 模型](#ollama)
- [使用问题汇总](#usage-notes)
  - [别忘了填写你的配置](#config)
  - [如何添加图片到 PPT 中](#assets)
  - [关于预览模式](#preview)
  - [关于导出](#export)
- [未签名应用打不开的问题(mac已损坏等问题)](#unsigned-app)
- [需求反馈](#feedback)
- [赞助支持](#sponsor)
- [参考](#references)
- [赞助者](#sponsors)
- [贡献者](#contributors)
- [License](#license)

---

<a id="why"></a>
## 🎯 为什么做这个

**让 AI HTML PPT 成为可能。**

每次要做分享/汇报/路演/答辩就头疼，纠结PPT排版占了大半时间

市面上AI PPT工具虽然多，但大多生成的是固定格式文件，想微调样式或加入自己想要的动画演示都很麻烦

所以自己写了一个Html版的PPT生成器——初衷是给自己做个工具使用

生成的是HTML版PPT：打开即预览、无需软件、一个浏览器搞定，还能随心改样式/加动效/插代码/导出分享

<a id="features"></a>
## ✅ 能做什么

- 💬 **一句话生成** — 输入主题和需求，AI 自动规划大纲 + 配色 + 排版，直接出完整 PPT
- 🔀 **多任务生成** — 可同时提交多个生成任务并行执行，不用等一个完成再创建下一个，后台生成完成时自动弹出通知
- 📄 **从文档创建** — 也支持上传 txt、md、csv、docx 文档，自动整理主题、页数和详细描述，生成时**继续参考原文件内容生成创意PPT**
- 📥 **导入 PPTX 编辑** — 可把本地 PPTX 转成应用内 HTML 页面，继续预览、调整位置和对话修改（也会提取pptx风格到系统中复用）
- 🧱 **模板库与模板创建** — 可将已生成或已编辑的演示保存为模板，也支持 PPTX 导入为模板，并可复用模板创建新的 PPT 会话
- 🎨️ **图片识别生成风格与大纲** — 支持上传截图/设计稿，自动识别视觉特征并生成独特风格与演示大纲(需要支持多模态模型的AI)
- 🔒 **本地优先** — 全部跑在自己电脑上，不用注册、不用担心数据泄露
- 🔤 **字体管理** — 内置 14 款精选 Google 字体（含中文），支持上传本地字体，创建时可分别指定标题和正文字体，也可交给 AI 自动匹配
- 🎨 **内置 30+ 风格SKILL** — 极简白、赛博霓虹、包豪斯、日式简约、小红书白… 也支持自定义风格
- ✏️ **对话式修改** — 对着某一页说"标题换个颜色""加个数据图表"，精准修改不用重做
- 🖱️ **可视化编辑** — 一切可见元素皆可拖拽和调整大小，一切元素皆可检选并让 AI 修改
- 📸 **插入图片和视频** — 编辑模式下直接上传图片和视频到页面，支持从素材库或本地文件添加
- 📋 **复制元素** — 一键复制任意元素（文字、图片、视频等），自动偏移并独立可编辑
- ↩️ **撤销和重做** — 编辑过程中随时撤销和重做操作，最后再统一保存为版本记录
- 🗑️ **删除元素** — 支持删除任意元素，也支持快捷键快速删除
- 🖥️ **演示模式** — 一键进入全屏演示播放，键盘左右键或点击切换页面
- 📝 **演讲稿生成** — 支持为整套幻灯片或当前页生成演讲稿，内置正式演讲、轻松对话、叙事风格和自定义风格
- 🎬 **动画演示** — 支持 16+ 种页面切换动画，也支持基于 Anime.js v4 的基础整元素动画
- 🧮 **数学公式渲染** — 支持常见 LaTeX 公式显示，适合课堂、教学、技术分享等场景
- 📄 **多格式导出** — 支持 PDF、批量 PNG、MP4 视频，并提供可编辑 PPTX 导出（字体自动嵌入，持续优化中）
- 🏷️ **会话管理** — 会话列表可区分 AI 创建和 PPTX 导入，也支持修改演示稿名称
- 🧩 **更稳的页面生成** — 生成时会按固定 16:9 画布与内容高度预算组织页面，减少内容溢出
- 🔄 **历史版本回退** — 自动保存每次修改记录，支持任意版本一键回退，改错了也不怕，随时回到满意的状态
- 📦 **一键打包** — 将 HTML 演示稿打包为单个可执行文件，双击即可打开预览，无需安装任何软件（有浏览器就行）
- 💾 **会话生成的创意PPT导入导出** — 编辑页面一键导出会话生成的创意 PPT，另一台电脑导入后可继续二次编辑，跨设备协作无缝衔接

<p>
<img width="30%" alt="Oh My PPT - 9" src="./docs/images/home.webp" />
<img width="30%" alt="Oh My PPT - 10" src="./docs/images/10.webp" />
<img width="30%" alt="Oh My PPT - 11" src="./docs/images/11.webp" />
</p>


<a id="workflow"></a>
## 🔄 使用流程

> 💡 选择创作方式 → 确认主题 / 资料 / 页数 / 风格 / 字体 → AI 生成 HTML 演示稿 → 预览、演示、编辑 → 生成演讲稿 → 导出 PDF / PNG / PPTX / MP4 / HTML 打包文件

首页支持几种常用入口：

- **一句话创建**：直接填写主题和详细描述，快速生成一份完整演示稿。
- **对话创作**：先通过多轮对话梳理主题、资料、受众、结构和每页重点，适合需求还不够清晰、资料较复杂，或者需要先共同推敲大纲的场景。
- **上传文档解析**：上传 txt、md、csv、docx 等文件，让应用先整理主题、页数和详细描述，生成时继续参考原文件内容。
- **从模板创建**：在模板页选择已保存的模板，可直接复制为可编辑 PPT 会话，也可以输入新主题/大纲或上传文档解析后，沿用模板版式、配色和视觉节奏重新生成内容。

文档解析会检查大纲和页数是否一致：例如大纲里写了 5 页，创建页也会尽量填成 5 页。你的文档只会保存在本地工作目录中，应用会把它整理成 AI 更容易读取的文本。

如果已经有现成的 PPTX，也可以在首页点击「导入 PPTX」，把文件转换成应用里的可编辑页面，继续预览、调整位置、对话修改和导出。

也可以将现有会话保存到模板库，或在模板页导入 PPTX 作为模板，后续反复复用同一套结构和视觉风格创建新的 PPT 会话。

生成后可以进入预览或演示模式，也可以在编辑页继续拖拽元素、插入图片/视频、对话修改、回退历史版本，并为整套幻灯片或当前页生成演讲稿。

<a id="style-skills"></a>
## 🎨 内置 30+ 风格 Skill
<img src="./docs/images/4.webp" alt="Oh My PPT" width="500" />

<a id="fonts"></a>
## 🔤 字体管理

内置 14 款精选 Google 字体（含中文字体），同时支持上传本地 `.woff2` 字体文件，可自定义字体名称、分类（无衬线/衬线/手写/等宽等）、用途（标题/正文）和语言类型（拉丁/CJK）。

创建演示稿时，可以分别指定**标题字体**和**正文字体**，也可以交给 AI 根据演示主题和风格自动匹配最合适的字体组合。导出 PPTX 时，已使用的字体会自动嵌入到文件中，确保在其他电脑上打开时字体显示一致。

<img src="./docs/images/font.webp" alt="Oh My PPT" width="500" />



<a id="animations"></a>
## 🎬 动画支持

Oh My PPT 的页面是 HTML 幻灯片，支持 16+ 种页面切换动画，并内置本地 **Anime.js v4** 动画运行时。生成或编辑页面时，可以让 AI 为标题、数据卡片、图片、图表容器、步骤模块等整块元素添加演示动画。

动画更偏向真实演讲场景：让内容按讲述节奏逐步出现，而不是一页内容一次性全部铺开。适合汇报、路演、课堂演示和产品讲解。

目前支持这些常用表达：

- **淡入**：模块出现时轻量过渡。
- **位移入场**：从上、下、左、右短距离滑入，适合标题、卡片和列表。
- **缩放强调**：关键数字或结论卡片轻微放大后回落。
- **错峰展示**：多张卡片或多条要点按顺序依次出现。
- **点击逐条出现**：演示时通过点击逐步展开内容，方便按讲述节奏推进。

更推荐使用“整个元素”的动画，而不是把文字拆成很多碎片逐字乱动。这样画面更稳、可读性更好，也更适合导出和二次编辑。动画主要用于引导视线和表达层级，不建议做复杂时间线、高频闪烁、无限循环或大幅抖动。

<p></>
<img src="https://arcsin1.github.io/anime.gif" alt="Oh My PPT animation demo" width="40%" />
<img src="./docs/images/anime.gif" alt="Oh My PPT animation demo" width="40%" />
</p>

<a id="ollama"></a>
## 🦙 支持本地 Ollama 模型（OpenAI 兼容）

项目支持通过 **OpenAI 兼容协议** 接入本地 Ollama。

在「设置」页面这样填写即可：

- `provider`: `openai`
- `base_url`: `http://127.0.0.1:11434/v1`
- `model`: 你本地拉取的模型名（例如 `qwen2.5-coder:14b`），建议支持 14B+（或云端强模型）
- `api_key`: 任意非空字符串（例如 `ollama`）

说明：

- Ollama 默认不校验 API Key，但应用侧会做“非空”校验，所以不能留空。
- 推荐使用 14B+（或云端强模型）做接入生成。
- 项目默认不使用 thinking / reasoning 模式。配置自定义 OpenAI 兼容 `base_url` 时，应用会自动请求关闭 thinking，避免工具调用、文档解析和重试生成时出现 `reasoning_content` 兼容问题。


<a id="usage-notes"></a>
## 关于使用问题汇总

<a id="config"></a>
### 别忘了填写你的配置
 > 推荐：deepseek v4、kimi、doubao、qwen、glm、xiaomi-mimo、minimax等等更多国产模型、以及gpt、claude、等等国外模型

  在「设置」页面填写你的模型配置，否则会报错。 

  <img src="./docs/images/3.png" alt="Oh My PPT" width="500" />



<a id="assets"></a>
### 如何添加图片到 PPT 中

   注：图片或者素材只会复制到你的本地创意目录，不会上传到云端
 
  <img src="./docs/images/edit.webp" alt="Oh My PPT" width="500" />

<a id="preview"></a>
### 关于预览模式
   
   支持键盘（左右键）切换，支持演示模式，全屏演示模式，ESC退出演示模式
  
  <img src="./docs/images/2.png" alt="Oh My PPT" width="500" />

<a id="export"></a>
### 关于导出

目前支持四种导出方式：

- **PDF**：适合直接分享、归档和打印。
- **PNG**：一键批量导出所有页面图片，适合插入文档、Notion、公众号或社媒内容。
- **PPTX**：导出为可在 PowerPoint / Keynote 中继续编辑的文件。当前会尽量保留文字、图片、颜色、公式和基础布局，并持续优化文字重叠、混排和复杂图表的效果。
- **MP4**：导出为视频文件，适合发布到社媒、发送给客户或在不方便播放 PPT 的场景中使用。


<a id="unsigned-app"></a>
## 📦 未签名应用打不开的问题

目前发布包可能还没有进行系统级代码签名，所以 macOS 或 Windows 第一次打开时可能会出现安全提示。这个提示通常不是应用损坏，而是系统对“未签名/未公证应用”的默认拦截。

### macOS

如果 macOS 提示“无法打开”“已损坏”“无法验证开发者”，可以按下面任意一种方式处理。

**方式一：右键打开**

1. 打开「访达」或「应用程序」文件夹。
2. 找到 `OhMyPPT.app`。
3. 右键点击应用，选择「打开」。
4. 在弹窗里再次点击「打开」。

这种方式通常只需要做一次，之后就可以正常双击打开。

**方式二：清除隔离属性**

如果右键打开仍然不行，可以在终端执行：

```bash
xattr -cr /Applications/OhMyPPT.app
```

然后重新打开应用。

如果你把应用放在了其他目录，请把命令里的路径替换成实际路径，例如：

```bash
xattr -cr ~/Downloads/OhMyPPT.app
```

### Windows

Windows 可能会因为安装包未签名而触发 SmartScreen 提示，例如“Windows 已保护你的电脑”。这是未签名应用常见的系统提示。

处理方式：

1. 在提示窗口点击「更多信息」。
2. 确认应用名称是 `OhMyPPT`。
3. 点击「仍要运行」。

如果下载后被浏览器或杀毒软件拦截，可以先确认安装包来自本项目的 GitHub Releases 页面，再选择保留或允许运行。

> 建议只从官方 Release 地址下载安装包，避免使用第三方转存文件。

<a id="feedback"></a>
## 🙌 需求反馈

如果你有新需求、功能建议或发现问题，欢迎在仓库提交 Issue或者国内加入反馈群。

<p>
  <a href="https://discord.gg/FSkzBgsQ"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="https://arcsin1.github.io/v.png">📱 微信群</a>
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="https://arcsin1.github.io/qq.png">💬 QQ群</a>
</p>
我会持续跟进并优化体验。


<a id="sponsor"></a>
## 赞助支持

目前主要由我一人开发和维护，如果您觉得 Oh My PPT 对您有所帮助，可以赞助支持一下（不要超过 ¥5，以及备注好你的 GitHub ID），谢谢。

<p>
<img src="https://arcsin1.github.io/v-s.jpg" alt="WeChat Pay" width="200" />
&nbsp;
<img src="https://arcsin1.github.io/z-s.jpg" alt="Alipay" width="200" />
</p>

<a id="references"></a>
## 参考

- [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
- [html-ppt-skill](https://github.com/lewislulu/html-ppt-skill)

<a id="sponsors"></a>
## 💖 赞助者

特别感谢每一位支持过 Oh My PPT 的朋友！你们的鼓励和赞助是持续迭代的最大动力。

查看 [SponsorsList.md](./SponsorsList.md) 获取完整赞助者列表。

<a id="contributors"></a>
## 贡献者

Thanks to all contributors!

<p>
<a href="https://github.com/m13891290332"><img src="https://github.com/m13891290332.png" width="50" height="50" alt="m13891290332" /></a>
<a href="https://github.com/whisper-xiang"><img src="https://github.com/whisper-xiang.png" width="50" height="50" alt="whisper-xiang" /></a>
<a href="https://github.com/Jacobinwwey"><img src="https://github.com/Jacobinwwey.png" width="50" height="50" alt="Jacobinwwey" /></a>
</p>

<a id="license"></a>
## License

This project is licensed under the [Apache License 2.0](LICENSE) © 2026 arcsin1 &lt;zy19931129@gmail.com&gt;.
