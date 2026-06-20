# Chrome Web Store Submission Notes

This file collects the store listing copy and review notes for the Chrome Web Store build of Image Lens.

## Release Version

`1.0.0`

## Single Purpose Description

Analyze images on web pages and turn them into editable prompts for image generation with the user's own Gemini API key.

## Store Name

Image Lens

## Summary / Short Description

Analyze webpage images and generate editable prompts with your own Gemini API key.

## Chinese Summary / Short Description

分析网页图片内容，并用你自己的 Gemini API Key 生成可编辑提示词。

## Detailed Description

Image Lens helps you inspect images on web pages and turn them into prompts you can edit, copy, and reuse for image generation.

What it does:

- Adds an analysis button on images you choose on web pages.
- Generates short and full prompt versions.
- Supports English and Chinese interface language.
- Lets you view prompts in a structured format.
- Lets you edit and copy prompts directly.
- Optionally generates new images from the prompt with your own Gemini API key.

How it works:

- You provide your own Gemini API key in the extension settings.
- When you click an image, the extension reads that image and sends the image data to Gemini API for analysis.
- On sites that block direct image fetching, the extension locally captures the visible tab and crops only the image area you clicked before sending that cropped image to Gemini API.
- If image generation is enabled, the extension sends the current prompt to Gemini API to generate images.

Privacy model:

- The developer does not provide or host API keys.
- Settings are stored locally in `chrome.storage.local`.
- The extension does not send your API key or browsing data to the developer.

## Chinese Detailed Description

Image Lens 可以帮你分析网页里的图片，并将图片内容整理成可编辑、可复制、可复用的提示词，方便继续用于生图或二次创作。

主要功能：

- 在网页图片上提供识别入口。
- 生成精简版和完整版提示词。
- 支持中英文界面切换。
- 支持结构化查看提示词内容。
- 支持直接编辑和复制提示词。
- 可选开启生图功能，并使用你自己的 Gemini API Key 进行生成。

工作方式：

- 你需要在插件设置页填写自己的 Gemini API Key。
- 当你点击网页图片时，插件会读取该图片，并将图片数据发送到 Gemini API 进行识别分析。
- 如果某些网站限制直接读取图片，插件会先在本地截取当前可见标签页，再只裁剪出你点击的图片区域后发送到 Gemini API。
- 如果开启了生图功能，插件会将当前提示词发送到 Gemini API 生成图片。

隐私方式：

- 开发者不会提供或托管 API Key。
- 插件设置保存在本地 `chrome.storage.local`。
- 插件不会把你的 API Key、网页内容或生成结果发送给开发者。

## Privacy Practices Tab

### Single purpose

Analyze user-selected webpage images and convert them into editable prompts for image generation, with optional prompt-based image generation, using the user's own Gemini API key.

### Data use disclosure

Disclose that the extension processes the following when the user actively triggers analysis or generation:

- Webpage image content selected by the user
- Page URL
- Image alt text when available
- Cropped image area from the visible tab when direct image fetch is blocked by the site
- User-provided prompt text for image generation
- User-provided Gemini API key stored locally

### Data handling statement

Use wording consistent with the privacy policy:

- Data is used only to provide the user-facing image analysis and image generation features.
- API keys are stored locally in the browser.
- The developer does not receive or store API keys, webpage content, prompts, or generated images.

## Permission Justifications

### `storage`

Used to store the user's Gemini API key, selected Gemini models, interface language, and feature settings locally in the browser.

### `<all_urls>`

Used to show the analysis entry point on webpage images and, when the user clicks an image, read that image for analysis. On sites that block direct image access, it is also used to locally crop the clicked image area from the visible tab before sending that cropped image to Gemini API.

### `https://generativelanguage.googleapis.com/*`

Used to send user-triggered image analysis and image generation requests to Gemini API.

## Screenshots Checklist

Chrome recommends at least 1 screenshot and allows up to 5. Use actual UI from the latest build.

Recommended set:

1. Options page showing Gemini API key setup and language selector.
2. In-page analysis panel on a real webpage image.
3. Structured prompt view in English.
4. Structured prompt view in Chinese.
5. Optional image generation result viewer.

Screenshot rules to follow:

- Use actual product UI, not mockups that misrepresent behavior.
- Prefer `1280x800` or `640x400`.
- Keep text on the screenshot minimal.
- Avoid blurry, stretched, or padded images.

## Store Assets Checklist

- `128 x 128` store icon already exists in the extension package.
- Prepare at least 1 screenshot, preferably 5.
- Optional but recommended: small promo tile `440 x 280`.
- Optional: marquee image `1400 x 560`.

## Review Risk Notes

Current code and docs were aligned with the following review-sensitive areas:

- Minimum permissions: removed unused `tabs` permission.
- Single purpose: image analysis to prompt generation, with optional prompt-based image generation as part of the same workflow.
- Disclosure consistency: privacy policy, README, and UI now explicitly refer to Gemini API key usage.
- Data handling disclosure: screenshot crop fallback is documented.

## Submission Reminder

Before submitting, make sure the Chrome Web Store Privacy tab matches:

- The extension behavior in code
- The privacy policy at `PRIVACY.md`
- The descriptions in the store listing
