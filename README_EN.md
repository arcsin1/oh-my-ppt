<div align="center">
  <img src="thumb.png" alt="Oh My PPT" width="200" />
  <br/>
  <br/>

<p align="center">
  <a href="https://github.com/arcsin1/oh-my-ppt" target="_blank">
    <img alt="AI PPT Generator" src="https://img.shields.io/badge/AI%20PPT-Generator-2f6d49"/>
  </a>
  <a href="https://github.com/arcsin1/oh-my-ppt/releases" target="_blank">
    <img alt="Downloads" src="https://img.shields.io/github/downloads/arcsin1/oh-my-ppt/total?style=flat&label=downloads&logo=github&logoColor=white"/>
  </a>
  <a href="#features">
    <img alt="Local-first" src="https://img.shields.io/badge/Local--first-Private-3b7a57"/>
  </a>
  <a href="./LICENSE" target="_blank">
    <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-green"/>
  </a>
  <a href="https://www.electronjs.org/" target="_blank">
    <img alt="Electron" src="https://img.shields.io/badge/Electron-Desktop-47848f"/>
  </a>
</p>

**Oh My PPT - Local-first AI Slide Deck, Image Generation & Editing Workbench**

[中文](./README.md) | [Why](#why) • [Features](#features) • [Workflow](#workflow) • [Changelog](./CHANGELOG.md) • [Usage Notes](#usage-notes)

  <p>
    AI-powered editable HTML, reinventing how next-generation presentations are made.<br/>
    Describe what you want to say and let AI shape the outline, slides, and visuals.<br/>
    Create, edit, present, and export in one local-first workflow.<br/>
    Local-first · Your models, your workflow.
  </p>

  [Website](https://www.ohmyppt.cc) | [Download](https://github.com/arcsin1/oh-my-ppt/releases)

  <img src="./docs/images/OhMyPPT.png"/>

</div>

---

<a id="sponsors-list"></a>
## 🏢 Sponsors

| Sponsor | About |
| --- | --- |
| <a href="https://www.toumingren.xyz/" target="_blank"><img src="./docs/images/toumingren.png" width="200" alt="toumingren" /></a> | [Toumingren](https://www.toumingren.xyz/) — Turn subscriptions into a programmable API. No black boxes — just a transparent middle layer. |

<a id="sponsors"></a>
## 💖 Backers

Thanks to everyone who has supported Oh My PPT — see [SponsorsList.md](./SponsorsList.md) for the full list.

---

## Table of Contents

- [Sponsors](#sponsors-list)
- [Backers](#sponsors)
- [Why I Built This](#why)
- [Import Legacy PPTX Templates for Editing](#pptx-import)
- [Export Editable PPTX from the Desktop App](#pptx-export)
- [What It Can Do](#features)
- [Workflow](#workflow)
- [90+ Built-in Style Skills](#style-skills)
- [AI Image Generation & Smart Visuals](#image-generation)
- [Font Management](#fonts)
- [Animation Support](#animations)
- [Local Ollama Support](#ollama)
- [Usage Notes](#usage-notes)
  - [Configure your models first](#config)
  - [About preview mode](#preview)
  - [About export](#export)
- [Opening Unsigned Apps](#unsigned-app)
- [Reference](#references)
- [Contributors](#contributors)
- [License](#license)

---

<a id="why"></a>
## 🎯 Why I Built This

**Making AI-powered HTML presentations possible.**

Every time I needed to prepare a talk, report, pitch, or defense, most of the time went into layout tweaks.

There are many AI PPT tools, but most output fixed-format files. Fine-tuning styles or adding custom animation demos is still painful.

So I built my own HTML-based PPT generator, originally as a personal tool.

Output is pure HTML slides: instant browser preview, no extra software, easy to tweak styles, add motion, embed code, and export to PDF / PNG / editable PPTX.

<a id="pptx-import"></a>
## 📥 Import Legacy PPTX Templates for Editing, Close to 100% Fidelity

Bring existing PPTX templates, past reports, or client files into the desktop app and keep editing. Typical PPTX imports restore close to **100%** of the original visual and structural result, converting files into pages you can drag, adjust, modify with AI, and manage through version history. Imported files can also yield reusable styles for future work.

Parsing and structured conversion are **fully in-house**; complex shapes, charts, tables, and animations continue to improve, and fidelity varies with the source file's features, fonts, and asset complexity.

<a id="pptx-export"></a>
## 📤 Export Editable PPTX from the Desktop App, Close to 100% Fidelity

After creating or editing in the desktop app, export a true PPTX that remains editable in PowerPoint / Keynote. In typical cases, the exported file preserves close to **100%** of its visual and structural result, including text, images, colors, formulas, and basic layout where possible.

HTML-to-editable-PPTX generation and layout are **fully in-house**; complex charts, tables, shapes, and animations are still being improved.

<a id="features"></a>
## ✅ What It Can Do

- 📥 **Import legacy PPTX templates for editing, close to 100% fidelity** — Imported files become pages you can drag, adjust, modify with AI, and manage through version history; parsing and conversion are fully in-house
- 📤 **Export editable PPTX from the desktop app, close to 100% fidelity** — Export decks as true PPTX files that remain editable in PowerPoint / Keynote; generation and layout are fully in-house
- 💬 **Topic-based creation** — Set the topic, detailed brief, and page options; AI plans the outline, palette, and layout, then generates a complete deck
- 🔀 **Multi-task generation** — Submit multiple generation tasks in parallel without waiting for one to finish before starting another, with automatic notifications on completion
- 📐 **Multi-size, multi-format canvases** — 16:9, 4:3, vertical 9:16, portrait 3:4, square 1:1, Xiaohongshu/social-note formats and more, with the real aspect ratio preserved from generation to export
- 📄 **Document-based creation** — Upload txt, md, csv, or docx files and the app prepares the topic, page count, and brief automatically; generation keeps referencing the source document to produce creative decks grounded in your content
- 🧱 **Template library and template creation** — Save generated or edited decks as templates, import PPTX files as templates, and reuse templates to create new PPT sessions
- 🖼️ **Image-based style and outline generation** — Upload a screenshot or design mockup to automatically extract a distinctive visual style and generate an outline (requires a multimodal AI model)
- 🖼️ **AI image generation and smart visuals** — Enable automatic visuals while creating a deck. AI generates illustrations, backgrounds, and visual assets only where the current content, layout, and chosen style call for them, instead of forcing an image onto every slide
- ✨ **In-editor image studio** — Generate a prompt from the current slide title and outline, add your own direction and image size, then preview the result, add it to the canvas, or make it the slide background
- 🏷️ **Image-generation style filtering** — The style library marks styles that support image generation, so automatic visuals can follow the deck's visual direction
- 🔒 **Local-first** — Sessions, source documents, assets, and generated results stay on your computer. No Oh My PPT account or platform cloud is required. Requests made to your configured AI or image service are sent to that provider
- 🔤 **Font management** — 14 curated Google Fonts built-in (including CJK), upload local fonts, pick title and body fonts separately or let AI auto-match
- 🎨 **90+ built-in style skills** — Minimal White, Cyber Neon, Bauhaus, Japanese Minimal, Xiaohongshu White, and more, plus custom styles
- ✏️ **Chat-based editing** — Tell it "change title color" or "add a data chart" on a specific page, without rebuilding everything
- 🖱️ **Visual editing** — Every visible element can be dragged and resized, and every element can be picked and modified with AI
- 📸 **Image and video insertion** — Upload images and videos directly in edit mode from the asset library or local files, and use them alongside AI-generated images
- 📋 **Element duplication** — One-click copy of any element (text, images, videos, etc.), auto-offset and independently editable
- ↩️ **Undo and redo** — Undo and redo edits freely before committing, then save as a version history entry
- 🗑️ **Element deletion** — Delete any element with a click or keyboard shortcut
- 🖥️ **Presentation mode** — Enter fullscreen presentation with one click, navigate slides with arrow keys or clicks
- 📝 **Speaker script generation** — Generate scripts for the full deck or the current slide, with formal, casual conversational, storytelling, and custom styles
- 🎬 **Animation support** — 16+ slide transition effects plus Anime.js v4-powered whole-element motion
- 🎞️ **Per-element animation controls** — Select individual text, image, chart, or other elements while editing, then configure entrance, emphasis, or exit effects with automatic/click triggers, duration, and direction
- 🧮 **Math formula rendering** — Display common LaTeX formulas for classes, teaching decks, and technical talks
- 📄 **Other export formats** — Export to PDF, batch PNG, PNG long image, or MP4 video
- 🏷️ **Session management** — Session list distinguishes AI-created decks from imported PPTX decks, and deck names can be renamed
- 🧩 **More reliable page layout** — Generation follows the selected canvas size and content-height budget to reduce overflow
- 🔄 **Version history rollback** — Every edit is automatically saved, roll back to any previous version with one click, never worry about mistakes
- 📦 **One-click packaging** — Bundle your HTML deck into a single executable file, double-click to open and present anywhere, no installation needed (just a browser)
- 💾 **Creative deck import & export** — Export the session's AI-generated creative deck from the editor in one click, import it on another computer to continue editing, and collaborate seamlessly across devices

<p>
  <img width="32%" alt="Oh My PPT Home" src="./docs/images/home.webp" />
  <img width="32%" alt="Oh My PPT Style Library" src="./docs/images/style.webp" />
  <img width="32%" alt="Oh My PPT Editor" src="./docs/images/edit.webp" />
</p>

<a id="workflow"></a>
## 🔄 Workflow

> 💡 Import a legacy PPTX template to keep editing, or choose a creation mode → confirm topic / materials / page count / canvas format / style / fonts / visuals → AI generates the HTML deck → preview, present, and edit → export an editable PPTX from the desktop app with close to 100% fidelity, PDF / PNG / PNG long image / MP4 / packaged HTML

<img src="./docs/images/home.webp" alt="Oh My PPT Home Entry Points" width="600" />

The home page supports several common entry points:

- **Topic-based creation**: set the topic, canvas format, and detailed brief to create a complete deck, vertical page, square card, or Xiaohongshu/social-note format.
- **Chat to Create**: use a multi-turn conversation to clarify the topic, materials, audience, structure, and key points for each slide. This is useful when requirements are still unclear, the source material is complex, or you want to shape the outline together first.
- **Upload document parsing**: upload txt, md, csv, docx, and other files so the app can prepare the topic, page count, and detailed description, then keep referencing the source file during generation.
- **Create from template**: choose a saved template from the Templates page to copy it into an editable PPT session, or enter a new topic/outline or upload a document so the app regenerates content while preserving the template's layout, palette, and visual rhythm.

To import a legacy PPTX template, click "Import PPTX" on the home page; typical files are restored with close to 100% fidelity for further editing. Existing sessions can also be saved to the template library and reused.

After configuring and verifying an image model in **Settings**, enable **Image Generation** on the creation page and pick a style marked **Image generation**; visuals are produced only where they genuinely improve the page. Automatic visuals add generation time — you can still generate images on demand in the editor when it is off.

After generation, preview or present the deck, keep editing (drag elements, insert images/videos, chat edits, roll back history, generate speaker scripts), and export — imported or newly created alike — as an editable PPTX with close to 100% fidelity.

<a id="style-skills"></a>
## 🎨 90+ Built-in Style Skills

To create your own Style Skill, use the official style generation package: [arcsin1/style-generate-skill](https://github.com/arcsin1/style-generate-skill). It helps turn reference designs, palettes, and layout requirements into importable Oh My PPT style packages.

<img src="./docs/images/style.webp" alt="Oh My PPT Style Library" width="600" />

<a id="image-generation"></a>
## 🖼️ AI Image Generation & Smart Visuals

Image generation has two entry points for deck-wide visuals and targeted additions:

| Use case | How to use it | Result |
| --- | --- | --- |
| Create a full deck | Add and **verify** an image model under **Settings → Image Models**, enable **Image Generation** on the creation page, and choose a style marked **Image generation** | AI produces illustrations, backgrounds, or visual elements only in suitable layout slots, preserving text-safe space and the selected visual style |
| Edit an existing slide | Open the editor's image-generation panel, generate a prompt from the current slide or write one yourself, then choose a model and size | Preview the generated image, add it to the canvas for layout work, or set it as the current slide background |

Built-in provider presets include Jimeng 3.0 / 4.0, Agnes AI, Seedream, SiliconFlow, Gemini, and OpenAI-compatible image APIs; text and image models are configured separately. Image configurations are saved only after passing a real test under **Settings → Image Models**.

Successful outputs are archived in the session's local asset directory, ready to edit, replace, export, or move with the session. Automatic visuals keep the canvas format and never replace images you uploaded. Image requests are sent to the provider you choose — follow its privacy and content policies.

<a id="fonts"></a>
## 🔤 Font Management

14 curated Google Fonts are built in (including CJK families). You can also upload local `.woff2` font files and customize the font name, category (sans-serif, serif, handwriting, monospace, and more), role (title / body), and script type (Latin / CJK).

When creating a deck, you can choose **title fonts** and **body fonts** separately, or let AI automatically match the best font pair based on the topic and style. When exporting to PPTX, used fonts are automatically embedded so the deck displays consistently on other computers.

<a id="animations"></a>
## 🎬 Animation Support

Oh My PPT generates HTML slides with 16+ slide transition effects and a local **Anime.js v4** runtime. During generation or chat-based editing, the AI can add presentation motion to whole slide elements such as titles, metric cards, images, chart containers, and step blocks.

In addition to AI-generated motion, edit mode lets you select an individual element and configure its entrance, emphasis, or exit effect, together with automatic or click triggering, duration, and direction.

Animations are designed for real presentation flow: content can appear step by step with the speaker's rhythm instead of showing everything on the slide at once. This works well for reports, pitches, classes, and product walkthroughs.

Common animation expressions include:

- **Fade in**: lightweight transitions when modules appear.
- **Slide-in motion**: short movement from top, bottom, left, or right for titles, cards, and lists.
- **Scale emphasis**: gently enlarge key numbers or conclusion cards, then settle back.
- **Staggered reveal**: reveal cards or bullets one after another.
- **Click-to-reveal**: reveal content step by step during presentation, so the deck follows your speaking pace.

Whole-element animation is preferred over splitting text into many tiny moving fragments. It keeps slides readable, stable, and easier to export or edit later. Animations are meant to guide attention and show hierarchy, so complex timelines, high-frequency flashing, infinite loops, and large shaking motion are not recommended.

<p>
  <img src="./docs/images/anime.webp" alt="Oh My PPT Animation Settings" width="40%" />
  <img src="./docs/video/anime.gif" alt="Oh My PPT Animation Demo" width="40%" />
</p>

<a id="ollama"></a>
## 🦙 Local Ollama Support (OpenAI-Compatible)

This project supports local Ollama through the **OpenAI-compatible API**.

Fill the Settings page like this:

- `provider`: `openai`
- `base_url`: `http://127.0.0.1:11434/v1`
- `model`: your local model tag (for example `qwen2.5-coder:14b`); a 14B+ model (or a strong cloud model) is recommended
- `api_key`: any non-empty string (for example `ollama`)

Notes:

- Ollama does not validate API keys by default, but this app enforces a non-empty check, so `api_key` cannot be blank.
- 14B+ local models (or strong cloud models) are recommended for stable generation quality.
- Official OpenAI endpoints do not receive the non-standard `thinking` parameter, avoiding `400 Unknown parameter` responses. Other OpenAI-compatible `base_url` values still request disabled thinking so multi-turn tool flows do not lose `reasoning_content`.
- The Ollama setup is for text generation, document parsing, and chat editing. Configure an image-capable provider separately under **Settings → Image Models** for image generation or automatic visuals.

<a id="usage-notes"></a>
## Usage Notes

<a id="config"></a>
### Configure your models first

> Recommended: DeepSeek V4, Kimi, Doubao, Qwen, GLM, MiMo, MiniMax and other Chinese models, plus GPT, Claude and other international models.

Set up the model for creation, document parsing, and editing under **Settings → Text Models**. Deck generation cannot start without it.

For AI image generation or automatic visuals, add the provider's full JSON configuration under **Settings → Image Models** and select **Verify**. Verification generates a real test image; it must succeed before the configuration can be saved, then it can be selected on the creation page and in the editor.

<a id="preview"></a>
### About preview mode

Navigate slides with the left/right arrow keys; presentation mode and fullscreen presentation mode are both supported, and `ESC` exits the presentation.

<a id="export"></a>
### About export

Oh My PPT currently supports five export modes, plus standalone HTML packaging:

- **PDF**: best for sharing, archiving, and printing.
- **PNG**: batch-export every slide as an image for docs, Notion, articles, or social posts.
- **PNG long image**: stitch the full set of pages vertically into one long image for social posts, chat sharing, long-document previews, and mobile reading.
- **Editable PPTX**: fully in-house export foundation, close to 100% fidelity in typical cases, remains editable in PowerPoint / Keynote.
- **MP4**: export the presentation as a video for social posts, client sharing, or playback when a PPT file is not the best fit.
- **Packaged HTML**: bundle the deck and its runtime resources so it can be opened and presented in a browser with a double click.

<img src="./docs/images/edit2.webp" alt="Oh My PPT Export Menu" width="600" />

<img src="./docs/images/exp.webp" alt="Oh My PPT Export Content Preview" width="600" />

<a id="unsigned-app"></a>
## 📦 Opening Unsigned Apps

Release builds may not be code-signed yet, so macOS or Windows can show security warnings on first launch. This usually does not mean the app is broken; it is the operating system blocking unsigned or unnotarized software by default.

### macOS

If macOS says the app cannot be opened, is damaged, or cannot verify the developer, use either option below.

**Option 1: Right-click Open**

1. Open Finder or the Applications folder.
2. Find `OhMyPPT.app`.
3. Right-click the app and choose **Open**.
4. Click **Open** again in the confirmation dialog.

This usually only needs to be done once.

**Option 2: Clear the quarantine attribute**

If right-click Open still does not work, run:

```bash
xattr -cr /Applications/OhMyPPT.app
```

Then open the app again.

If you placed the app somewhere else, replace the path with the actual location, for example:

```bash
xattr -cr ~/Downloads/OhMyPPT.app
```

### Windows

Unsigned installers may trigger Windows SmartScreen, such as "Windows protected your PC". This is expected for unsigned apps.

Steps:

1. Click **More info**.
2. Confirm the app name is `OhMyPPT`.
3. Click **Run anyway**.

If your browser or antivirus blocks the file, first confirm the installer came from this project's GitHub Releases page, then choose to keep or allow the file.

> Download builds only from the official Releases page when possible.

<a id="references"></a>
## Reference

- [@arcsin1/pptx2json](https://www.npmjs.com/package/@arcsin1/pptx2json) — Oh My PPT's fully in-house foundation for editable PPTX import, parsing PPTX files into editable structured data. Support for complex shapes, charts, tables, animations, and more will continue to improve.
- [@arcsin1/html2pptx](https://www.npmjs.com/package/@arcsin1/html2pptx) — Oh My PPT's fully in-house foundation for editable PPTX export, converting HTML into true, editable PPTX files. Support for complex shapes, charts, tables, animations, and more will continue to improve.
- [arcsin1/style-generate-skill](https://github.com/arcsin1/style-generate-skill) — the official Oh My PPT style-generation Skill for turning reference designs, palettes, layouts, and scenario requirements into importable style packages.
- [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
- [html-ppt-skill](https://github.com/lewislulu/html-ppt-skill)

<a id="contributors"></a>
## Contributors

Thanks to all contributors!

<p>
<a href="https://github.com/m13891290332"><img src="https://github.com/m13891290332.png" width="50" height="50" alt="m13891290332" /></a>
<a href="https://github.com/whisper-xiang"><img src="https://github.com/whisper-xiang.png" width="50" height="50" alt="whisper-xiang" /></a>
<a href="https://github.com/Jacobinwwey"><img src="https://github.com/Jacobinwwey.png" width="50" height="50" alt="Jacobinwwey" /></a>
</p>

<a id="license"></a>
## License

This project is licensed under the [Apache License 2.0](LICENSE) © 2026 arcsin1 &lt;zy19931129@gmail.com&gt;.
