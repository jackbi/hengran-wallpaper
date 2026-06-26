import { mkdir, writeFile, readFile, access } from "fs/promises";
import { join } from "path";

// TinyPNG Web API 配置
const TINYPNG_DOMAINS = [
  "https://tinypng.com",
  "https://tinyjpg.com",
  "https://tinify.cn",
];
const COMPRESS_THRESHOLD = 800 * 1024; // 800KB

interface TinyPngResponse {
  input: { size: number; type: string };
  output: { size: number; type: string; url: string; width: number; height: number; ratio: number };
}

// Wallhaven API 配置
const API_BASE = "https://wallhaven.cc/api/v1/search";
const DEFAULT_PARAMS = "ratios=9x16,10x16,9x18&sorting=relevance&order=desc";

// 目录配置
const IMAGES_DIR = join(import.meta.dir, "..", "images");
const STATE_FILE = join(import.meta.dir, "..", ".last-fetch.json");
const PAGES_DIR = join(import.meta.dir, "..", "pages");
const INDEX_FILE = join(import.meta.dir, "..", "index.json");

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

// 生成随机 IP
function randomIp(): string {
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 256)).join(".");
}

// 随机选择 TinyPNG 域名
function randomDomain(): string {
  return TINYPNG_DOMAINS[Math.floor(Math.random() * TINYPNG_DOMAINS.length)];
}

// 使用 TinyPNG Web API 压缩图片
async function compressImage(buffer: ArrayBuffer, fileType: string): Promise<ArrayBuffer | null> {
  const domain = randomDomain();
  const contentType = fileType === "image/jpeg" ? "image/jpeg" : "image/png";

  try {
    // Step 1: 上传图片获取压缩后的下载 URL
    const uploadRes = await fetch(`${domain}/backend/opt/shrink`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "X-Forwarded-For": randomIp(),
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      console.warn(`⚠️  TinyPNG upload failed (${uploadRes.status})`);
      return null;
    }

    const result = (await uploadRes.json()) as TinyPngResponse;

    if (!result.output?.url) {
      console.warn("⚠️  TinyPNG response missing download URL");
      return null;
    }

    console.log(
      `🗜️  TinyPNG: ${(result.input.size / 1024).toFixed(0)}KB → ${(result.output.size / 1024).toFixed(0)}KB (ratio: ${(result.output.ratio * 100).toFixed(1)}%)`
    );

    // Step 2: 下载压缩后的图片
    const downloadRes = await fetch(result.output.url);
    if (!downloadRes.ok) {
      console.warn(`⚠️  TinyPNG download failed (${downloadRes.status})`);
      return null;
    }

    return await downloadRes.arrayBuffer();
  } catch (error) {
    console.warn("⚠️  TinyPNG compression failed:", error);
    return null;
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

// 保存页面数据
async function savePageData(page: number, images: string[]): Promise<void> {
  try {
    await mkdir(PAGES_DIR, { recursive: true });
    const pageFile = join(PAGES_DIR, `page-${page}.json`);
    const pageData = {
      page,
      fetchedAt: new Date().toISOString(),
      count: images.length,
      images,
    };
    await writeFile(pageFile, JSON.stringify(pageData, null, 2));
    console.log(`📄 Page ${page} data saved: ${images.length} images`);
  } catch (error) {
    console.warn(`⚠️  Failed to save page ${page} data:`, error);
  }
}

// 更新总索引
async function updateIndex(totalPages: number, totalImages: number): Promise<void> {
  try {
    let index = { totalPages: 0, totalImages: 0, lastUpdated: "" };

    // 读取现有索引
    if (await fileExists(INDEX_FILE)) {
      const data = await readFile(INDEX_FILE, "utf-8");
      index = JSON.parse(data);
    }

    // 更新索引
    index.totalPages = totalPages;
    index.totalImages = totalImages;
    index.lastUpdated = new Date().toISOString();

    await writeFile(INDEX_FILE, JSON.stringify(index, null, 2));
    console.log(`📊 Index updated: ${index.totalPages} pages, ${index.totalImages} images`);
  } catch (error) {
    console.warn("⚠️  Failed to update index:", error);
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

    let buffer = await response.arrayBuffer();

    // 检查文件大小，超过阈值则压缩
    if (buffer.byteLength > COMPRESS_THRESHOLD) {
      console.log(
        `📦 ${filename} is ${(buffer.byteLength / 1024).toFixed(0)}KB, compressing...`
      );
      const compressed = await compressImage(buffer, wallpaper.file_type);
      if (compressed && compressed.byteLength < buffer.byteLength) {
        console.log(
          `✅ Compressed: ${(buffer.byteLength / 1024).toFixed(0)}KB → ${(compressed.byteLength / 1024).toFixed(0)}KB`
        );
        buffer = compressed;
      } else {
        console.log(`⏭️  Skipped compression (no improvement)`);
      }
    }

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

  // 自定义 API 参数（取第一个 = 后面的所有内容）
  const customParams = paramsArg ? paramsArg.substring(paramsArg.indexOf("=") + 1) : undefined;

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
  console.log(`📁 Output directory: ${IMAGES_DIR}\n`);

  // 下载统计
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let totalPagesProcessed = 0;
  let totalImagesSaved = 0;

  // 下载第一页的图片
  console.log(`\n📦 Processing page ${startPage}...`);
  const firstPageImages: string[] = [];

  for (const wallpaper of firstPage.data) {
    try {
      const result = await downloadImage(wallpaper, IMAGES_DIR);
      if (result) {
        downloaded++;
        totalDownloaded++;
        firstPageImages.push(`${wallpaper.id}.${wallpaper.file_type.split("/")[1]}`);
      } else {
        skipped++;
        // 已存在的图片也加入列表
        firstPageImages.push(`${wallpaper.id}.${wallpaper.file_type.split("/")[1]}`);
      }
    } catch (error) {
      failed++;
    }
    // 下载间隔
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // 保存第一页数据
  await savePageData(startPage, firstPageImages);
  totalPagesProcessed++;
  totalImagesSaved += firstPageImages.length;

  // 获取剩余页面并逐页下载
  for (let page = startPage + 1; page <= totalPages; page++) {
    // 添加延迟避免请求过快
    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      console.log(`\n📦 Processing page ${page}...`);
      const pageData = await fetchPage(page, customParams);
      const pageImages: string[] = [];

      // 立即下载当前页的图片
      for (const wallpaper of pageData.data) {
        try {
          const result = await downloadImage(wallpaper, IMAGES_DIR);
          if (result) {
            downloaded++;
            totalDownloaded++;
            pageImages.push(`${wallpaper.id}.${wallpaper.file_type.split("/")[1]}`);
          } else {
            skipped++;
            pageImages.push(`${wallpaper.id}.${wallpaper.file_type.split("/")[1]}`);
          }
        } catch (error) {
          failed++;
        }
        // 下载间隔
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // 保存当前页数据
      await savePageData(page, pageImages);
      totalPagesProcessed++;
      totalImagesSaved += pageImages.length;
    } catch (error) {
      console.error(`❌ Failed to fetch page ${page}:`, error);
    }
  }

  // 更新总索引
  await updateIndex(totalPages, totalImagesSaved);

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
  console.log(`   📁 Total images: ${totalImagesSaved}`);
  console.log(`\n🎉 Completed!`);
}

main().catch(console.error);
