# GameDataEditor

GameDataEditor 是一个面向游戏策划、数值设计和内容生产流程的本地化数据编辑器。它以浏览器静态页面运行，围绕“表结构 + 实体数据 + 资源引用 + 卡片化预览”的工作方式组织游戏数据，并提供类型配置、资源管理、卡片样式编辑、历史记录、搜索和 AI 辅助扩展能力。

![GameDataEditor 截图](screenshots/ScreenShot_2026-05-09_180304_372.png)

## 特性

- **表驱动的数据编辑**：以独立 JSON 表文件管理游戏实体数据，支持多表浏览、标签页打开和结构化字段编辑。
- **项目级类型系统**：通过 `gamedata.json` 维护自定义类型、枚举、范围、资源类型和复合类型，让字段定义更稳定。
- **资源引用管理**：使用 `asset://...` 约定引用图片、音频等资源，保持数据与素材目录的清晰关系。
- **卡片样式编辑**：为不同数据表配置卡片视图，将实体数据以更接近游戏内表现的方式预览和校对。
- **编辑器式工作区**：采用多面板布局，包含表列表、类型配置、资源面板、属性检查器、日志、搜索、历史记录等常用工具。
- **AI 辅助接口**：内置面向 GameDataEditor 的 AI 适配层设计，可向 AI 提供项目、表、实体、字段、资源和卡片样式上下文，并通过补丁方式应用变更。
- **纯前端运行**：无需安装服务端依赖，可直接在现代浏览器中打开使用。

## 快速开始

克隆仓库后，直接打开根目录的 `index.html`：

```bash
git clone https://github.com/jinruozai/game-data-editor.git
cd game-data-editor
open index.html
```

如果浏览器对本地文件访问有额外限制，也可以使用任意静态文件服务器启动：

```bash
python3 -m http.server 8080
```

然后访问：

```text
http://localhost:8080
```

## 项目结构

```text
.
├── index.html                 # 应用入口
├── logo.png                   # 应用图标
├── src/                       # 编辑器业务代码
│   ├── ai/                    # AI 资源、工具、补丁和技能适配
│   ├── panels/                # 各编辑器面板
│   ├── project-io/            # 项目导入导出与工作区读写
│   └── main.js                # 应用布局和启动逻辑
├── vendor/                    # 前端运行依赖
├── docs/                      # 数据格式和 AI 接口文档
├── skills/                    # 项目内置 AI 技能
├── uploads/                   # 示例或导入资料
└── screenshots/               # 项目截图
```

## 数据格式

GameDataEditor 推荐将一个游戏数据项目组织为：

```text
project-root/
  gamedata.json
  asset/
  角色.json
  道具.json
  关卡/章节1.json
```

- `gamedata.json` 保存项目名称、版本、类型配置和卡片样式。
- 除 `gamedata.json` 和 `asset/` 外，其他 `.json` 文件会被视为数据表。
- 每张表通过 `_table.struct_def` 描述字段结构。
- 实体 ID 使用 JSON object key 保存，建议在整个项目内保持唯一。
- 图片和音频等资源推荐使用 `asset://路径/文件名` 引用。

更完整的约定见 [docs/data-format.md](docs/data-format.md)。

## AI 扩展

项目包含 GameDataEditor 的 AI 适配设计，目标是把编辑器内的结构化上下文交给 AI，而不是简单复制页面文本。当前设计覆盖：

- 项目摘要、类型配置、表、实体、字段、资源、卡片样式等资源引用。
- 数据变更补丁的校验、预览和应用。
- 项目本地技能和数据编辑约束。

相关说明见 [docs/ai-system-design.md](docs/ai-system-design.md)、[docs/ai-interface-contract.md](docs/ai-interface-contract.md) 和 [docs/ai-integration-targets.md](docs/ai-integration-targets.md)。

## 开发说明

当前项目是无打包步骤的静态前端应用，修改源码后刷新浏览器即可验证。主要入口和职责如下：

- `src/main.js`：创建编辑器布局、挂载面板并安装 AI 适配层。
- `src/state.js`：维护项目数据、打开表、选择实体、日志和脏状态。
- `src/project-io/`：处理目录、ZIP、资源和编解码逻辑。
- `src/panels/`：实现表、类型配置、资源、检查器、搜索、历史和卡片样式相关面板。
- `src/ai/`：实现 GameDataEditor 与框架 AI 的资源解析、工具调用和补丁应用。

## 远程仓库

- Gitee: https://gitee.com/lazygoo/game-data-editor.git
- GitHub: https://github.com/jinruozai/game-data-editor.git

## License

当前仓库尚未声明开源许可证。若要对外分发或允许他人复用，请先补充明确的 LICENSE 文件。
