// 使い方:
//   テキストのみ:   npm run post -- "投稿したい文章"
//   画像を添付:     npm run post -- "文章" --image 写真.png
//   リンクカード:   npm run post -- "文章" --url https://アドレス
//   リンク+サムネイル: npm run post -- "文章" --url https://アドレス --image サムネイル.png
import fs from "node:fs";
import { apiVersion, TOKEN_FILE, type SavedToken } from "./config.js";

// LinkedInは一部の特殊文字を文章の書式記号として扱うため、
// そのまま文字として見せるには前に \ を付ける必要がある。（「エスケープ」と言う）
function escapeText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, "\\$&");
}

function loadToken(): SavedToken {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error("先に `npm run login` でログインしてください。");
  }
  const token = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8")) as SavedToken;
  if (Date.now() > token.expiresAt) {
    throw new Error(
      "アクセストークンの期限が切れています（約60日有効）。`npm run login` をもう一度実行してください。",
    );
  }
  return token;
}

// コマンドライン入力を分ける: 文章と --オプションを区別する。
interface PostOptions {
  text: string;
  images: string[];
  url?: string;
}

function parseArgs(argv: string[]): PostOptions {
  const opts: PostOptions = { text: "", images: [] };
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--image") opts.images.push(argv[++i] ?? "");
    else if (arg === "--url") opts.url = argv[++i];
    else words.push(arg);
  }
  opts.text = words.join(" ").trim();
  return opts;
}

// 画像1枚をLinkedInに先にアップロードしておき、投稿に付けられるアドレス番号（URN）を受け取る。
async function uploadImage(token: SavedToken, filePath: string): Promise<string> {
  const initRes = await fetch(
    "https://api.linkedin.com/rest/images?action=initializeUpload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Linkedin-Version": apiVersion,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        initializeUploadRequest: { owner: token.personUrn },
      }),
    },
  );
  if (!initRes.ok) {
    throw new Error(`画像アップロードの準備に失敗: ${initRes.status} ${await initRes.text()}`);
  }
  const { value } = (await initRes.json()) as {
    value: { uploadUrl: string; image: string };
  };

  const putRes = await fetch(value.uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token.accessToken}` },
    body: fs.readFileSync(filePath),
  });
  if (!putRes.ok) {
    throw new Error(`画像アップロードに失敗: ${putRes.status} ${await putRes.text()}`);
  }
  return value.image; // 例: urn:li:image:abc123
}

async function createPost(token: SavedToken, opts: PostOptions): Promise<string> {
  // 添付の種類によって投稿の「中身」の部分が変わる。一度に付けられるのは1種類だけ。
  let content: Record<string, unknown> | undefined;
  if (opts.url) {
    // リンクカード: 本文は外部のURLにあり、投稿にはリンクカードだけが付く。
    const article: Record<string, unknown> = { source: opts.url };
    if (opts.images[0]) article.thumbnail = await uploadImage(token, opts.images[0]);
    content = { article };
  } else if (opts.images.length === 1) {
    content = { media: { id: await uploadImage(token, opts.images[0]) } };
  } else if (opts.images.length > 1) {
    const uploaded = [];
    for (const path of opts.images) {
      uploaded.push({ id: await uploadImage(token, path) });
    }
    content = { multiImage: { images: uploaded } };
  }

  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Linkedin-Version": apiVersion,
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      author: token.personUrn, // 誰が書くのか（自分）
      commentary: escapeText(opts.text), // 文章
      visibility: "PUBLIC", // 全体公開（つながりのみ: "CONNECTIONS"）
      distribution: {
        feedDistribution: "MAIN_FEED", // フィード（メイン画面）に表示
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      ...(content ? { content } : {}),
      lifecycleState: "PUBLISHED", // すぐに投稿
      isReshareDisabledByAuthor: false,
    }),
  });

  // 成功すると201が返り、新しい投稿のアドレス番号はヘッダー（応答の頭の部分）に入っている。
  if (res.status !== 201) {
    throw new Error(`投稿に失敗: ${res.status} ${await res.text()}`);
  }
  return res.headers.get("x-restli-id") ?? "";
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.text && opts.images.length === 0 && !opts.url) {
    console.log('使い方: npm run post -- "投稿したい文章" [--image 写真.png] [--url https://アドレス]');
    process.exit(1);
  }

  const token = loadToken();
  const postId = await createPost(token, opts);
  console.log("✅ 投稿完了！");
  console.log(`   https://www.linkedin.com/feed/update/${postId}/`);
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
