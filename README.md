# 安居建业PPT助手

安居建业内部使用的 Windows 演示文稿制作工具。项目基于 [Oh My PPT](https://github.com/arcsin1/oh-my-ppt) 二次开发，统一使用安居建业 2024 年 6 月标准 PPT 模板和公司视觉规范。

## 内部版范围

- 首页输入主题或提纲，一键按公司模板生成演示。
- 上传 PDF、DOCX、Markdown、TXT、CSV、图片等资料，读取内容后生成公司演示。
- 通过多轮 AI 对话梳理内容，再按公司模板生成演示。
- 导入已有 PPTX，继续进行 AI 修改和可视化编辑。
- 支持页面预览、演示、拖拽编辑、AI 改页、图片生成、动画和演讲稿。
- 仅导出可编辑 PPTX、PDF 和逐页 PNG。
- 历史演示与版本记录保存在本机，不需要账号登录。

内部版不提供通用模板市场、自定义风格与字体、Token 统计、英文界面、竖版/方形/社媒画布、MP4/HTML/会话包导出和公共自动更新。

## 公司模板

- 原始附件：`resources/corporate-template/source/安居建业PPT模板（2024年6月）.pptx`
- 内置可编辑模板：`resources/corporate-template/tpl_anjian_standard_v1/`
- 公司样式规则：`resources/styles/anjian-corporate/`

应用首次启动时会把版本化的公司模板复制到用户数据目录。公司模板不可重命名、覆盖或删除；所有新生成的演示固定为 16:9，并保留公司标识、红橙黄波浪及“内部文件 请勿外传”页脚。

## 个人 AI 服务（受控 BYOK）

公司目前没有统一 AI 服务，因此 v1 采用 BYOK（员工自备 API Key）：

1. 员工在“设置”页选择阿里云百炼、腾讯 TokenHub、DeepSeek，或高级自定义 OpenAI 兼容服务；
2. 填写服务地址、模型 ID 和个人 API Key；
3. 软件明确显示资料将发送到哪个域名，测试连接成功后才保存并启用；
4. 只有生成、AI 修改、扫描件识别等 AI 操作会要求配置，浏览、编辑、导出和旧 PPTX 本地导入不要求 API Key。

预设服务会校验官方域名；高级自定义只接受 HTTPS 地址，并在界面突出显示数据发送目标。Key 通过 Electron `safeStorage` 加密保存在本机，安全存储不可用时拒绝落盘，不回退为明文；设置页和渲染进程只接收脱敏占位符。网页会员订阅不能代替开发者 API Key，员工需自行在相应服务商控制台开通 API。

AI 生图在首版 BYOK 中默认关闭。

## 开发与验证

环境要求：Node.js 20+、pnpm 10.x。

```bash
pnpm install
pnpm dev
pnpm typecheck:web
pnpm test
```

项目当前只发布 Windows x64 NSIS 安装包：

```bash
pnpm build:win
```

安装包名称为 `AnjuJianye-PPT-Assistant-<version>-x64-setup.exe`。构建前不需要写入公司端点或个人 Key；应在干净的 Windows x64 环境分别使用受支持服务完成 BYOK 连接，并验收安装、启动、生成、编辑及三种导出格式。

交付前请执行：

- [Windows / WPS 试点验收清单](docs/acceptance/Windows-WPS-试点验收清单.md)
- [内部版功能边界与保留说明](docs/architecture/内部版功能边界与保留说明.md)

## 许可与上游说明

本项目保留上游 Apache-2.0 `LICENSE` 与 `NOTICE`。二次开发的产品名称、企业模板和品牌资产不改变上游代码的许可及署名要求。
