import { mkdir, writeFile, readFile, access } from "fs/promises";
import { join } from "path";

// Wallhaven API 配置
const API_BASE = "https://wallhaven.cc/api/v1/search";
const DEFAULT_PARAMS = "ratios=9x16,10x16,9x18&sorting=relevance&order=desc";

// 目录配置
const IMAGES_DIR = join(import.meta.dir, "..", "images");
const STATE_FILE = join(import.meta.dir, "..", ".last-fetch.json");

interface Wallpaper {
  id: string;
  url: string;
  short_url: string;
  views: number;
  favorites: number;
  source: string;
  purity: string;
  category: string;
  dimension_x: number;
  dimension_y: number;
  resolution: string;
  ratio: string;
  file_size: number;
  file_type: string;
  created_at: string;
  colors: string[];
  path: string;
  thumbs: {
    large: string;
    original: string;
    small: string;
  };
}

interface ApiResponse {
  data: Wallpaper[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    query: string | null;
    seed: string | null;
  };
}

interface FetchState {
  lastPage: number;
  params: string;
  fetchedAt: string;
  totalDownloaded: number;
}

// 检查文件是否存在
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// 读取上次拉取状态
async function loadState(): Promise<FetchState | null> {
  try {
    if (await fileExists(STATE_FILE)) {
      const data = await readFile(STATE_FILE, "utf-8");
      return JSON.parse(data) as FetchState;
    }
  } catch (error) {
    console.warn("⚠️  Failed to load state file:", error);
  }
  return null;
}

// 保存拉取状态
async function saveState(state: FetchState): Promise<void> {
  try {
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`💾 State saved: page ${state.lastPage}, ${state.totalDownloaded} images`);
  } catch (error) {
    console.warn("⚠️  Failed to save state file:", error);
  }
}

// 获取单页数据
async function fetchPage(page: number, params?: string): Promise<ApiResponse> {
  const url = `${API_BASE}?${params || DEFAULT_PARAMS}&page=${page}`;
  console.log(`📥 Fetching page ${page}...`);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return (await response.json()) as ApiResponse;
}

// 下载单张图片
async function downloadImage(
  wallpaper: Wallpaper,
  outputDir: string
): Promise<boolean> {
  const ext = wallpaper.file_type.split("/")[1];
  const filename = `${wallpaper.id}.${ext}`;
  const filepath = join(outputDir, filename);

  // 检查是否已下载
  if (await fileExists(filepath)) {
    console.log(`⏭️  Skipping ${filename} (already exists)`);
    return false;
  }

  console.log(`⬇️  Downloading ${filename} (${wallpaper.resolution})...`);

  try {
    const response = await fetch(wallpaper.path, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Referer: "https://wallhaven.cc/",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    await writeFile(filepath, Buffer.from(buffer));
    console.log(
      `✅ Downloaded ${filename} (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB)`
    );
    return true;
  } catch (error) {
    console.error(`❌ Failed to download ${filename}:`, error);
    return false;
  }
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const pagesArg = args.find((arg) => arg.startsWith("--pages="));
  const paramsArg = args.find((arg) => arg.startsWith("--params="));
  const resetArg = args.find((arg) => arg === "--reset");

  // 自定义 API 参数
  const customParams = paramsArg ? paramsArg.split("=")[1] : undefined;

  // 读取上次状态
  const lastState = await loadState();
  let startPage = 1;
  let totalDownloaded = 0;

  if (lastState && !resetArg) {
    // 检查参数是否相同
    const currentParams = customParams || DEFAULT_PARAMS;
    if (lastState.params === currentParams) {
      startPage = lastState.lastPage + 1;
      totalDownloaded = lastState.totalDownloaded;
      console.log(`📂 Resuming from page ${startPage} (last fetch: ${lastState.fetchedAt})`);
    } else {
      console.log(`⚠️  Parameters changed, starting from page 1`);
    }
  }

  // 默认下载 5 页
  const maxPages = pagesArg ? parseInt(pagesArg.split("=")[1]) : 5;
  const endPage = startPage + maxPages - 1;

  console.log(`🚀 Starting wallpaper download`);
  console.log(`📄 Pages: ${startPage} to ${endPage}`);

  // 创建目录
  await mkdir(IMAGES_DIR, { recursive: true });

  // 获取第一页以获取总页数
  const firstPage = await fetchPage(startPage, customParams);
  const totalPages = Math.min(firstPage.meta.last_page, endPage);

  console.log(`📊 Total pages available: ${firstPage.meta.last_page}`);
  console.log(`📄 Will fetch: ${startPage} to ${totalPages}`);

  // 收集所有壁纸
  let allWallpapers: Wallpaper[] = [...firstPage.data];

  // 获取剩余页面
  for (let page = startPage + 1; page <= totalPages; page++) {
    // 添加延迟避免请求过快
    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      const pageData = await fetchPage(page, customParams);
      allWallpapers.push(...pageData.data);
    } catch (error) {
      console.error(`❌ Failed to fetch page ${page}:`, error);
    }
  }

  console.log(`\n🖼️  Total wallpapers to download: ${allWallpapers.length}`);
  console.log(`📁 Output directory: ${IMAGES_DIR}\n`);

  // 下载图片
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const wallpaper of allWallpapers) {
    try {
      const result = await downloadImage(wallpaper, IMAGES_DIR);
      if (result) {
        downloaded++;
        totalDownloaded++;
      } else {
        skipped++;
      }
    } catch (error) {
      failed++;
    }
    // 下载间隔
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // 保存状态
  await saveState({
    lastPage: totalPages,
    params: customParams || DEFAULT_PARAMS,
    fetchedAt: new Date().toISOString(),
    totalDownloaded,
  });

  console.log(`\n📊 Download summary:`);
  console.log(`   ✅ Downloaded: ${downloaded}`);
  console.log(`   ⏭️  Skipped (already exists): ${skipped}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📄 Pages fetched: ${startPage} - ${totalPages}`);
  console.log(`\n🎉 Completed!`);
}

main().catch(console.error);
