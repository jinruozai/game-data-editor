# GameDataEditor 数据目录格式

这份文档面向直接修改数据目录的 AI、脚本或人工编辑者。目标是：改完 JSON 和资源后，GameDataEditor 能稳定打开、保存、导出，不产生错表、错资源、丢引用。

## 1. 项目目录

一个项目目录推荐长这样：

```text
project-root/
  gamedata.json
  asset/
  商品.json
  商品/消耗品.json
  角色.json
  asset/商品/消耗品/154520735508919.png
  asset/shared/icons/coin.png
```

规则：

- `gamedata.json` 是项目级配置文件，可以没有。
- 项目根目录只有一个特殊目录：`asset/`。
- `asset/` 是游戏资源目录，数据里用 `asset://...` 引用。
- 每张表是一个独立 `.json` 文件。
- 表路径等于文件路径去掉 `.json`。例如 `商品/消耗品.json` 的表路径是 `商品/消耗品`。
- 除 `gamedata.json` 和 `asset/` 之外，所有 `.json` 都是数据表，必须包含顶层 `_table`。
- 不要把普通配置 JSON 放在数据目录里；项目专属编辑器能力应通过独立二开工程接入，不放在数据目录里。
- JSON 必须是标准 JSON，不要写注释、尾逗号、`NaN`、`Infinity`。

## 2. gamedata.json

`gamedata.json` 保存项目元信息、项目自定义类型和卡片样式。

```json
{
  "project": {
    "name": "data",
    "version": 0
  },
  "type_config": {
    "quality": {
      "name": "Quality",
      "base_type": "int",
      "type_render": "enum",
      "default": 1,
      "mem": "品质",
      "type_agv": {
        "options": {
          "1": "普通",
          "2": "稀有",
          "3": "史诗"
        }
      }
    }
  },
  "card_styles": {
    "default": {
      "name": "Default",
      "root": {
        "id": "root",
        "component": "absolute",
        "props": {
          "width": 140,
          "height": 140,
          "background": "var(--ef-bg-0)",
          "borderRadius": 6
        },
        "bindings": {},
        "children": []
      }
    }
  }
}
```

规则：

- `project.name` 是显示名。
- `project.version` 是编辑器版本计数，脚本修改时可以保持原值。
- `type_config` 只写项目自定义类型或覆盖项；内置基础类型不用重复写。
- `card_styles.default` 推荐保留。表没有指定样式时会回退到 `default`。
- 如果没有 `gamedata.json`，编辑器仍会加载表；卡片样式使用默认值。导入时会把各表 `_table.struct_def` 中出现、但项目 `type_config` 尚未定义的字段名自动提升为项目类型，保证后续字段名和类型可以收敛到统一字典。

## 3. 表文件

每张表文件格式：

```json
{
  "_table": {
    "struct_def": {
      "name": { "type": "string", "mem": "显示名" },
      "icon": { "type": "img", "mem": "图标" },
      "quality": { "type": "quality", "mem": "品质" },
      "price": { "type": "int", "mem": "价格" },
      "tags": {
        "type": "array",
        "mem": "标签",
        "type_agv": { "elem_type": "string" }
      }
    },
    "card_style": "default"
  },
  "154520735508919": {
    "name": "密信",
    "icon": "asset://商品/154520735508919.png",
    "quality": 2,
    "price": 14,
    "tags": ["sealed", "secret"]
  },
  "527811951216731": {
    "name": "访问酒水",
    "icon": "asset://商品/527811951216731.png",
    "quality": 1,
    "price": 8,
    "tags": []
  }
}
```

规则：

- `_table` 是表定义，不是实体数据。
- `_table.struct_def` 定义字段结构。
- `_table.card_style` 是卡片样式 key，对应 `gamedata.json.card_styles`。
- `_table` 外层每个 key 都是实体 id。
- 实体 id 是 JSON object 的 key，因此在文件里天然是字符串。
- 实体 id 在整个项目内应全局唯一，不要只在单表内唯一。
- 实体字段名应来自 `struct_def`。可以临时保留额外字段，但推荐清理，避免 AI 误判。
- 字段缺失时，编辑器会按类型默认值补齐；最好显式写完整关键字段。

## 4. struct_def 字段定义

字段定义推荐统一写对象：

```json
{
  "field_name": {
    "type": "string",
    "mem": "字段说明",
    "default": ""
  }
}
```

也允许简写：

```json
{
  "name": "string"
}
```

推荐对象写法，因为说明、默认值、参数更清晰。

常用字段属性：

- `type`: 类型名，必须存在。
- `mem`: 字段说明，给编辑器和 AI 看。
- `default`: 新增或补齐字段时使用的默认值。
- `type_agv`: 类型参数，例如枚举选项、范围、数组元素类型。
- `group`: 属性面板分组名，可选。
- `desc`: 更详细说明，可选。

## 5. 类型系统

内置类型：

```text
int, float, string, struct, array, var
bool, percent, color, date
img, snd
id, ref_id
enum_int, enum_string
range_int, range_float
```

项目常用复合类型：

```text
id_num, id_string, string_num, img_num, snd_num, img_string, snd_string
```

值类型约定：

- `int`: JSON number，整数。
- `float`: JSON number。
- `string`: JSON string。
- `bool`: 0 或 1，不要写 true/false。
- `color`: 通常是整数色值，例如 `16711680`。
- `date`: 字符串，推荐 `YYYY-MM-DD`。
- `img`: 字符串，推荐 `asset://...`。
- `snd`: 字符串，推荐 `asset://...`。
- `id` / `ref_id`: 实体引用值。当前内置类型基于 `int`，推荐写 JSON number；实体本身的 id key 仍是字符串。
- `array`: JSON array。
- `struct`: JSON object。快捷结构也按字段名保存，例如 `id_num` 是 `{ "id": 123, "num": 10 }`。

枚举：

```json
{
  "type": "enum_string",
  "type_agv": {
    "options": {
      "weapon": "武器",
      "armor": "防具"
    }
  }
}
```

范围：

```json
{
  "type": "range_int",
  "type_agv": {
    "min": 1,
    "max": 100,
    "step": 1
  }
}
```

数组：

```json
{
  "type": "array",
  "type_agv": {
    "elem_type": "string"
  }
}
```

不要在 `struct_def` 里引用未定义类型。类型名必须是内置类型、项目 `type_config` 类型，或编辑器已知的复合类型。导入旧数据时，如果字段定义能通过已有类型解析，编辑器会自动把该字段名补进项目 `type_config`；完全无法解析的类型仍会进入日志提示。

## 6. 资源格式

资源引用使用 Godot 风格协议：

```text
asset://相对路径/文件名.ext
```

磁盘对应：

```text
asset/相对路径/文件名.ext
```

例子：

```json
{
  "icon": "asset://商品/消耗品/154520735508919.png",
  "voice": "asset://角色/10001_intro.wav"
}
```

对应文件：

```text
asset/商品/消耗品/154520735508919.png
asset/角色/10001_intro.wav
```

规则：

- `asset://` 后面永远是 `asset/` 目录内的相对路径。
- 不要写绝对路径，例如 `/Users/...`、`C:\...`。
- 不要写 `..` 逃逸路径。
- 路径分隔符统一用 `/`。
- 多个字段、多个实体可以引用同一个 `asset://...`。
- 资源目录是项目内容，保存/导出时应原样保留。
- 删除或移动资源时，必须同步修改所有引用它的字段。

属性面板外部拖入资源时的默认命名规则：

```text
asset://<table-path>/<entity-id>.<ext>
```

如果冲突：

```text
asset://<table-path>/<entity-id>_<field>.<ext>
asset://<table-path>/<entity-id>_<field>_2.<ext>
```

例如当前表 `商品/消耗品`，实体 id `154520735508919`，字段 `icon`，拖入 png：

```text
asset://商品/消耗品/154520735508919.png
asset://商品/消耗品/154520735508919_icon.png
asset://商品/消耗品/154520735508919_icon_2.png
```

Asset Panel 或资源管理器导入文件时，可以保留原文件名和目录结构：

```text
asset://shared/icons/coin.png
```

## 7. 卡片样式 card_styles

卡片样式是 UI 树。表通过 `_table.card_style` 引用样式 key。

最小结构：

```json
{
  "name": "Default",
  "root": {
    "id": "root",
    "component": "absolute",
    "props": {
      "width": 140,
      "height": 140
    },
    "bindings": {},
    "children": []
  }
}
```

节点结构：

```json
{
  "id": "name-text",
  "component": "text",
  "props": {
    "size": "sm",
    "textAlign": "center"
  },
  "bindings": {
    "value": {
      "source": "field",
      "field": "name"
    }
  },
  "layout": {
    "aMin": { "x": 0, "y": 1 },
    "aMax": { "x": 1, "y": 1 },
    "oMin": { "x": 0, "y": -24 },
    "oMax": { "x": 0, "y": -4 }
  },
  "children": []
}
```

规则：

- `root.id` 通常是 `"root"`。
- `root.component` 推荐 `"absolute"`。
- `root.props.width` / `height` 是卡片设计尺寸；卡片列表会按实际卡片大小缩放填满。
- 每个节点 `id` 在同一个 card style 内应唯一。
- `component` 必须是已注册 UI 组件名。
- `props` 是组件参数。
- `bindings` 把组件属性绑定到实体字段。
- `children` 是子节点数组。
- `layout` 用于 absolute 布局，包含锚点和偏移。

常用绑定：

```json
{
  "bindings": {
    "src": { "source": "field", "field": "icon" },
    "value": { "source": "field", "field": "name" },
    "text": { "source": "field", "field": "name" }
  }
}
```

## 8. AI 修改数据的推荐流程

修改前：

1. 先读取 `gamedata.json`，了解 `type_config` 和 `card_styles`。
2. 再读取要修改的表文件，看 `_table.struct_def`。
3. 确认字段类型后再改实体值。
4. 涉及资源时，确认 `asset://...` 对应文件存在。

新增实体：

1. 生成全局唯一 id，推荐 15 位数字字符串。
2. 在对应表文件外层新增同名 key。
3. 按 `_table.struct_def` 填写字段。
4. 图片/声音资源放到 `asset/`，字段写 `asset://...`。

新增字段：

1. 在 `_table.struct_def` 新增字段定义。
2. 给表内所有实体补上合理默认值。
3. 如果字段类型是自定义类型，先确保 `gamedata.json.type_config` 有定义。

移动或重命名资源：

1. 移动 `asset/` 下实际文件。
2. 全项目搜索旧 `asset://...`。
3. 将所有旧引用替换为新 `asset://...`。

重命名表路径：

1. 移动或重命名表 `.json` 文件。
2. 如果资源按表路径组织，按需移动 `asset/` 下资源。
3. 全项目搜索旧资源路径并替换。
4. 检查其他表中的 `ref_id` 是否仍指向正确实体 id。

## 9. 检查清单

提交修改前至少检查：

- 所有 JSON 能被标准 JSON parser 解析。
- 每个表文件都有 `_table.struct_def`。
- 表文件路径和表含义一致。
- 实体 id 全项目唯一。
- `struct_def` 里引用的类型都存在。
- 枚举值在 `type_agv.options` 中。
- `range` 值没有超出 min/max。
- `img` / `snd` 字段使用 `asset://...` 或明确的外部 URL。
- 每个 `asset://...` 都能在 `asset/` 目录找到对应文件。
- 没有绝对资源路径，没有 `..`。
- 移动/重命名资源后，所有引用已同步更新。
