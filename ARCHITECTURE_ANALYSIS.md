# 原项目审计与 Cloudflare Free 迁移分析

审计基线：`Arrow36/Hangul-Hanja-mixed-script` 于 2026-09-29 克隆的 `main`。词典基线：用户提供的 `전체 내려받기_한국어기초사전_json_20260919.zip`，SHA-256 `F9C1B9309AFE66429A92CCA1B2C426DB25EC809D04103ACA74C3A23859280DF6`。

## 原架构

```text
浏览器（app/static/index.html + app.js + styles.css）
    ↓ HTTP
FastAPI（app/main.py）
    ├─ TokenizerService → kiwipiepy.Kiwi（Python 原生模块）
    ├─ ConverterService → 按原文 offset 拼接转换段
    ├─ DisambiguationService → 词性、词汇级别、词典搭配打分
    └─ DictionaryService → aiosqlite → hanja_dict.db
```

- `app/main.py`：页面语言路径、`/api/convert`、`/api/lookup`、词条详情、原始 JSON、候选手选、统计与调试 API。
- `app/services/tokenizer.py`：包装 `kiwipiepy`，将 Kiwi token 规范成 `form/tag/start/length/original` 并按空白分组。
- `app/services/converter.py`：收集待查词形并批量查词；优先整词/复合词，然后处理单 token；按原文 offset 保留助词、词尾、空白及标点。
- `app/services/disambiguation.py`：可靠性、词性、词汇级别、替换类型与词典搭配评分；不足证据保留韩文。
- `app/services/dictionary.py`：候选批量查询、词条搜索、嵌套释义/例句、原始 JSON、统计和搭配提取。
- `app/schema.py`：11 张业务表及对应索引；`scripts/import_dictionary.py` 从官方 ZIP 生成数据库和 conversion candidates。
- `app/static/`：12 种 UI 语言、三种阅读模式、侧栏词典、词源、候选选择。Cloudflare 页面复用其 CSS 与主要 JS。
- `requirements.txt`：FastAPI、uvicorn、aiosqlite、pydantic、kiwipiepy 0.23.2。新站运行时不依赖 Python，Python 只负责词典导入和回归基线。

## 实测数据库

原版 SQLite 591,806,464 字节；56,555 词条、76,833 义项、659,075 例证、826,505 译词、34,150 conversion candidates。`entries.raw_json` UTF-8 内容共约 333.5 MB，单条最大 121,578 字节。`경제` 确有 `經濟` 的可靠候选。

[D1 Free 单库上限](https://developers.cloudflare.com/d1/platform/limits/)为 500 MB，故不能将原库原样放入一库。主库保留原表及索引，但 `entries.raw_json` 置空；原始 JSON 进入第二个 D1 的 `entry_raw_chunks`，按 6000 字符拆行，以避开 D1 单 SQL 语句长度限制。用同一 SQLite 数据创建的投影实测：主库 224,038,912 字节，原始 JSON 库 380,420,096 字节；两库均在单库限额内。D1 内部布局可能与本地 SQLite 不完全相同，导入时须监控实际占用。

## 迁移去向

| 原模块 | Cloudflare 版本 | 原因 |
| --- | --- | --- |
| `tokenizer.py` | `web/kiwi-worker.ts`, `web/kiwi.ts` | 官方 Kiwi WASM 在浏览器 Worker 初始化，兼容 `form/tag/start/len`；避免 Worker CPU 负担 |
| `converter.py` | `web/converter.ts` | 原文 offset、复合词优先及词干处理在浏览器执行 |
| `disambiguation.py` | `web/converter.ts` + `collocations.json` | 复用原评分阈值与 1,924 组词典搭配 |
| `dictionary.py` | `src/db.ts` + 两个 D1 | 参数绑定、索引查询、词条详情与原始 JSON |
| `main.py` | `src/worker.ts` | 词典 API 与静态资源路由；取消 `/api/convert` 和 Python debug API |
| `app/static/` | `public/` | 保留原 UI 与语言资源，替换转换调用 |

新架构：`Workers Static Assets + 浏览器 Kiwi WASM + TypeScript Converter + Worker API + D1 × 2`。不使用 Containers、R2 或付费服务器。

官方 Kiwi `kiwi-nlp@0.24.0` 的 `KiwiBuilder.create()` 加载 WASM，`build({modelFiles,modelType:'cong'})` 加载官方模型，`analyze()` 返回 `str/tag/position/length`。模型中 `cong.mdl` 约 75.9 MB，超过 Static Assets 单文件 25 MiB 限额；构建脚本验证 SHA-256 并拆为不超过 20 MiB 的资源。浏览器 Worker 负责下载、组装和初始化，避免阻塞 UI；HTTP 缓存和内存单例避免重复下载/初始化。

## Free Plan 约束

2026-09-29 核对的[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[Static Assets 限制](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)、[D1 容量及查询限制](https://developers.cloudflare.com/d1/platform/limits/)和[D1 Free 计量](https://developers.cloudflare.com/d1/platform/pricing/)见官方文档。静态资源请求可免费服务；词典 API 使用 Worker 请求和 D1 读取额度。完整词典主库约 180 万行，D1 Free 每日写入额度使首次导入需要多日分批，不能承诺当天完成。导入脚本支持中断续传。请始终以 Cloudflare 最新官方限制为准。

## 已知差异

1. 官方浏览器 Kiwi 0.24.0 + CoNg 模型与 Python `kiwipiepy` 0.23.2 默认模型可能在某些词的 token 边界和词性上不同。42 条回归在**相同 Python token 和同一词典候选**下显示文本 42/42 一致；这不能证明所有浏览器输入都字节级一致。
2. 词源搜索从原版的任意子串改为前缀搜索，借助索引避免 Free D1 的全表扫描；词形搜索保留前缀语义。转换词典查询为精确匹配。
3. `/api/convert` 与 `/api/debug/tokenize` 不再由服务器提供，前者迁至浏览器，后者由 `/kiwi-demo.html` 演示。
4. 首次打开须下载约 109 MB 模型资源；设备内存不足时初始化可能失败，页面会提示刷新。未来可评估更小的官方模型，但不能用简单正则替代 Kiwi。
