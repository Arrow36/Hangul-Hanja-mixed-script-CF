# Hangul–Hanja Mixed Script · Cloudflare Free

将[原版项目](https://github.com/Arrow36/Hangul-Hanja-mixed-script)迁移为 Cloudflare Workers Static Assets + 浏览器官方 Kiwi WebAssembly + TypeScript 转换器 + Workers API + 两个 D1。保留原页面样式、12 种界面语言、词源、候选选择及词典详情。无需 Containers、VPS、R2 或付费 Cloudflare 产品。

原项目架构与迁移依据见 [ARCHITECTURE_ANALYSIS.md](ARCHITECTURE_ANALYSIS.md)。本仓库不包含受词典来源约束的官方 ZIP、生成的数据库或模型二进制；构建脚本会从[Kiwi 官方发布](https://github.com/bab2min/Kiwi/releases/tag/v0.24.0)下载经校验的模型。词典需从[韩国语基础词典](https://krdict.korean.go.kr/download/downloadPopup)下载 JSON ZIP。

## 1. 获取代码与依赖

需要 Node.js 22+、Python 3.12+、Git、Cloudflare Free 账户。

```bash
git clone https://github.com/Arrow36/Hangul-Hanja-mixed-script-CF.git
cd Hangul-Hanja-mixed-script-CF
npm ci
python -m pip install -r requirements.txt
```

`npm run build` 会下载 Kiwi 0.24.0 官方 CoNg 模型，校验 SHA-256，拆为小于 Workers Static Assets 单文件限额的资源，并构建前端。首次构建需下载约 88 MB 压缩包；浏览器首次访问加载约 109 MB 模型资源，后续使用 HTTP 缓存，页面显示初始化状态。Kiwi 在浏览器 Web Worker 中运行，不在 Cloudflare Worker 中运行 Python。

## 2. 准备词典

将实际词典 ZIP 路径替换进命令。已验证用户提供的 `전체 내려받기_한국어기초사전_json_20260919.zip`，导入生成 `hanja_dict.db`；该文件不进入 Git。

```bash
python scripts/inspect_dictionary.py "/path/to/전체 내려받기_한국어기초사전_json_20260919.zip"
python scripts/import_dictionary.py "/path/to/전체 내려받기_한국어기초사전_json_20260919.zip"
python scripts/export_collocations.py
python scripts/export_d1.py hanja_dict.db output/d1
```

`output/d1/main` 与 `output/d1/raw` 各含分批 SQL。原 SQLite 为 591.8 MB，不能放入单个 D1 Free 数据库。实测主库投影约 224 MB，原始 JSON 库约 380 MB。主库保留词条、义项、译词、例证及候选；第二库保存原始 JSON 的分块。没有使用 R2。`collocations.json` 是原词典提取的 1,924 组消歧搭配；换词典快照时应重新生成并提交。

## 3. 登录 Cloudflare 并创建两个 D1

```bash
npx wrangler login
npx wrangler d1 create hangul-hanja-dictionary
npx wrangler d1 create hangul-hanja-raw
```

从两条命令的输出复制 `database_id`，分别替换 [wrangler.jsonc](wrangler.jsonc) 中的 `REPLACE_WITH_MAIN_D1_ID` 和 `REPLACE_WITH_RAW_D1_ID`。先在本地保存配置，再提交 GitHub。数据库 ID 不是密钥。

```bash
npx wrangler d1 migrations apply hangul-hanja-dictionary --remote
npx wrangler d1 migrations apply hangul-hanja-raw --remote
python scripts/import_d1.py output/d1/main hangul-hanja-dictionary
python scripts/import_d1.py output/d1/raw hangul-hanja-raw
```

**Free Plan 初次导入需多日。** 这份快照主库约 180 万业务行，远超 D1 Free 每日行写入额度，且索引也会增加写入计数。达到当日限额时脚本会停止；次日再次执行同一命令，脚本按本地检查点跳过已成功的 SQL 文件，同一文件的插入也使用 `INSERT OR IGNORE` 避免重放重复行。不要删除 `output/d1` 或其中的 `.imported-remote` 检查点，直到导入完成。D1 Free 限额按账户汇总，主库和原始 JSON 库共享每日额度。[最新额度与计量](https://developers.cloudflare.com/d1/platform/pricing/)请以官方文档为准。Cloudflare Free 超额后查询/写入会失败，而不会自动产生付费账单。

导入完成后核对关键词：

```bash
npx wrangler d1 execute hangul-hanja-dictionary --remote --command "SELECT written_form, origin_raw FROM entries WHERE written_form='경제'"
npx wrangler d1 execute hangul-hanja-dictionary --remote --command "SELECT count(*) AS n FROM entries"
npx wrangler d1 execute hangul-hanja-raw --remote --command "SELECT count(DISTINCT entry_id) AS n FROM entry_raw_chunks"
```

期望 `경제 → 經濟`、词条 56,555、原始 JSON 词条 56,555。导入占用请在 Cloudflare D1 面板确认；本地 SQLite 大小只是估计。

## 4. 本地运行与验证

```bash
npm run build
npm test
npx wrangler deploy --dry-run
npm run dev
```

打开 `http://127.0.0.1:8787/zh`。本地 D1 与远程分开，可用相同 migration 与导入脚本的 `--local` 选项建立本地完整词典：

```bash
npx wrangler d1 migrations apply hangul-hanja-dictionary --local
npx wrangler d1 migrations apply hangul-hanja-raw --local
python scripts/import_d1.py output/d1/main hangul-hanja-dictionary --local
python scripts/import_d1.py output/d1/raw hangul-hanja-raw --local
```

`/kiwi-demo.html` 是 Kiwi 最小浏览器测试，输入 `한국 경제가 빠르게 성장했다.` 后显示 `form/tag/start/len`。`scripts/verify_conversion.py` 从原 Python 版本生成 42 条回归样例；当前在相同 token/候选条件下 TypeScript 显示文本 42/42 一致，`npm test` 生成 `tests_cf/differences.json`。浏览器 Kiwi 模型与 Python 模型的差异仍可能影响其他句子。

## 5. 部署与 GitHub 自动部署

完成 D1 配置与至少主库导入后：

```bash
npm run deploy
```

Wrangler 会输出实际 `https://<worker>.<subdomain>.workers.dev` 地址。不要猜测域名；以命令输出为准。首次使用 Workers 时，Cloudflare 可能要求设置免费的 `workers.dev` 子域。

GitHub 仓库 **Settings → Secrets and variables → Actions** 中建立：

- `CLOUDFLARE_API_TOKEN`：作用域限于目标账户的 Workers 部署权限；
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账户 ID。

[官方 GitHub Actions 指南](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)要求这两个值。`.github/workflows/deploy.yml` 在 `main` push 后安装依赖、构建和测试；启用部署变量后再执行 Wrangler 部署。D1 数据由上面的导入步骤独立管理，不随每次 push 重建。

首次仓库发布时，Workflow 仅构建与测试。填好真实 D1 ID、完成导入并设置上述两个 Secrets 后，在 **Actions variables** 新增 `CLOUDFLARE_READY=true`；此后每次推送 `main` 即自动部署。设置变量后可手动运行一次 Workflow 触发首次自动部署。

## API 与缓存

- `POST /api/dictionary/batch`：最多 80 个唯一词，返回候选映射；转换在浏览器端将词形去重后分批请求。输入使用长度检查和 D1 参数绑定。
- `POST /api/dictionary/origins`：批量词源。
- `GET /api/lookup`：词形或词源前缀、词条 ID 搜索。
- `GET /api/entries/:id`、`/api/entries/:id/raw`：详情与完整原始 JSON。
- `POST /api/select-candidate`：验证用户手选的词条。
- `GET /api/version`、`/api/stats`：词典版本与统计。

浏览器使用内存 Map、IndexedDB 持久缓存与静态资源 HTTP 缓存。词典服务请求失败时显示明确错误，不会将输入文本加入 Cloudflare Cache。模型只在浏览器 Worker 中初始化一次。Cloudflare Worker bundle 本地 dry-run 为约 10 KiB，不包含 WASM/模型。

## 已知限制

- 首次模型下载量大，移动设备或低内存浏览器可能无法初始化；页面提示失败且不会悄悄使用低质量分词。
- 浏览器官方 Kiwi 0.24.0 CoNg 与原 Python `kiwipiepy` 0.23.2 默认模型可能在少数词上产生不同 token，进而影响结果。
- 词源搜索改为索引支持的前缀搜索，避免任意子串扫描触及 Free D1 读取额度。
- Free D1 首次完整导入需要分多天；在主库未导入完时，网站的词典数据不完整。
- 是否始终保持 0 美元取决于账户保持 Workers Free、没有启用付费产品，以及实际用量在[Workers](https://developers.cloudflare.com/workers/platform/limits/)、[D1](https://developers.cloudflare.com/d1/platform/limits/)与[Static Assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)官方当前限额内。超额时服务会受限。

原项目 GPL-3.0 许可证见 [LICENSE](LICENSE)。Kiwi 的 npm 包与模型遵守其[官方许可证](https://github.com/bab2min/Kiwi/blob/main/LICENSE)。词典文字数据来源：韩国国立国语院（국립국어원）[韩国语基础词典](https://krdict.korean.go.kr/)；本站的搭配文件及回归样例是基于该数据的转换，按官方[CC BY-SA 2.0 KR 著作权政策](https://krdict.korean.go.kr/kor/openApi/openApiRegister)标注与共享。音视频等多媒体资源可能有不同许可，本仓库不复制其文件。
