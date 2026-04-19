# Prompt Glass

一个基于 Chrome Manifest V3 的网页图片提示词助手。

核心能力：

- 悬浮在网页图片右上角显示按钮，点击后分析图片内容
- 生成可直接用于生图的提示词
- 中文 / English 切换
- 识别后可直接在面板内编辑提示词
- 一键复制
- 一键立刻生图
- 先接 Gemini，结构上预留未来兼容其他 provider
- 使用液态玻璃风格界面

## 目录结构

- `manifest.json`：Chrome 扩展配置
- `content.js` / `content.css`：网页悬浮按钮与侧边玻璃面板
- `background.js`：统一处理 API 调用、provider 抽象、打开结果页
- `options.*`：本地配置 Gemini key / proxy / 模型参数
- `viewer.*`：显示生图结果

## 安装方式

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择当前目录：`/Users/kevinchin/Documents/Playground`

## 使用方式

1. 安装后先打开扩展的 `选项页`
2. 选择一种模式：
   - `Direct`：本地保存你自己的 Gemini API key
   - `Proxy`：请求发到你自己的后端，前端不直接持有正式 key
3. 打开任意包含图片的网页
4. 鼠标移到图片上，右上角会出现一个玻璃按钮
5. 点击后自动分析图片，生成提示词
6. 你可以切中英、现场修改、复制，或直接生图

## 安全说明

这个项目**没有把 API key 写在代码里**，也**不会把 key 存进 Git 仓库**。当前实现的默认行为是：

- API key 由用户在 `options` 页面手动输入
- key 只保存在本地 `chrome.storage.local`
- `content script` 不直接持有 key，由 `background service worker` 统一请求 API

但需要注意：

- 只要是纯前端扩展，用户自己输入到本地的 key 依然属于“客户端持有”
- 如果你要公开发布给别人安装，最安全的做法仍然是改成你自己的后端代理
- 生产环境建议：
  - 前端只拿短期 token
  - 后端做请求签名、配额、限流、日志与风控
  - 针对不同 provider 做统一转发层

## Gemini 接口说明

当前实现默认假设：

- 图片分析 / 翻译：`generateContent`
- 立刻生图：Imagen `:predict`

参考的官方文档：

- [Image generation with Gemini](https://ai.google.dev/gemini-api/docs/image-generation)
- [Generate images using Imagen](https://ai.google.dev/gemini-api/docs/imagen)
- [Image understanding](https://ai.google.dev/gemini-api/docs/vision)

由于 Gemini 模型名、区域可用性、套餐权限可能变化，如果你本地账号没有权限，建议在 `options` 中改模型名或切换到你自己的代理服务。

## 后续建议

- 给不同网站做图片过滤策略，比如忽略头像、LOGO、太小的图
- 支持 OpenAI-compatible / Stability / Replicate 等 provider
- 加入 prompt 模板风格库，例如摄影、海报、3D、插画
- 支持右键菜单“分析这张图”
- 支持对结果图继续迭代生成
