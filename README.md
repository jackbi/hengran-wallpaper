# Hengran Wallpaper

从 [Wallhaven](https://wallhaven.cc) 下载壁纸图片的工具。

## 功能特性

- 🖼️ 批量下载壁纸图片
- 📄 支持多页获取
- ⏭️ 自动跳过已下载的图片
- 🔧 支持自定义 API 参数

## 项目结构

```text
hengran-wallpaper/
├── .github/
│   └── workflows/
│       └── fetch-wallpapers.yaml  # GitHub Actions 手动任务
├── images/                        # 壁纸图片
├── pages/                         # 每页数据 JSON
│   ├── page-1.json
│   ├── page-2.json
│   └── ...
├── index.json                     # 总索引（分页数据）
├── src/
│   ├── index.ts                   # Elysia 服务
│   └── fetch-wallpapers.ts        # 下载壁纸脚本
└── package.json
```

## 使用方法

### 本地运行

```bash
# 安装依赖
bun install

# 下载壁纸（默认前 5 页，约 120 张）
bun run fetch

# 下载更多页数
bun run fetch -- --pages=10

# 自定义 API 参数
bun run fetch -- --params="ratios=9x16&sorting=favorites&order=desc"

# 重置状态，从第1页开始
bun run fetch -- --reset
```

### 断点续传

脚本会自动记录上次拉取的位置（保存在 `.last-fetch.json`），下次执行时会从上次停止的页数继续：

```bash
# 第一次：下载第 1-5 页
bun run fetch -- --pages=5

# 第二次：自动从第 6 页开始下载
bun run fetch -- --pages=5

# 如果参数变了，会从第 1 页重新开始
bun run fetch -- --params="ratios=16x9"
```

### 命令行参数

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `--pages=N` | 获取页数 | 5 |
| `--params=...` | 自定义 API 参数 | ratios=9x16,10x16,9x18&sorting=relevance&order=desc |
| `--reset` | 重置状态，从第1页开始 | - |

### GitHub Actions

在 GitHub 仓库的 Actions 页面手动触发工作流，可配置：

- 获取页数
- 自定义 API 参数

## API 说明

使用 Wallhaven API：

```text
https://wallhaven.cc/api/v1/search?ratios=9x16,10x16,9x18&sorting=relevance&order=desc&page=1
```

返回数据包含：

- 壁纸 ID、URL
- 分辨率、文件大小、类型
- 分类、标签
- 颜色信息
- 缩略图和原图链接

## 图片命名

下载的图片以壁纸 ID 命名，例如：

- `5w52k3.png`
- `exxrrw.jpg`

## 数据文件

### 每页数据 (`pages/page-{N}.json`)

```json
{
  "page": 1,
  "fetchedAt": "2024-01-15T08:00:00.000Z",
  "count": 24,
  "images": [
    "5w52k3.png",
    "exxrrw.jpg",
    "q2w125.jpg"
  ]
}
```

### 总索引 (`index.json`)

用于第三方展示时的分页数据：

```json
{
  "totalPages": 5,
  "totalImages": 120,
  "lastUpdated": "2024-01-15T08:00:00.000Z"
}
```

### 分页展示示例

```javascript
// 获取总页数
const index = await fetch('/index.json').then(r => r.json());
const totalPages = index.totalPages; // 5

// 获取某一页的图片列表
const page1 = await fetch('/pages/page-1.json').then(r => r.json());
const images = page1.images; // ["5w52k3.png", "exxrrw.jpg", ...]

// 构建图片 URL
images.forEach(filename => {
  const url = `/images/${filename}`;
  // 使用 url 展示图片
});
```

## 注意事项

- API 请求有频率限制，脚本已添加延迟
- 已下载的图片会自动跳过
- 建议首次运行时先用少量页数测试

## License

MIT
