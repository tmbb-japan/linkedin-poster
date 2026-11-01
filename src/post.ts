// 사용법:
//   텍스트만:      npm run post -- "올리고 싶은 글 내용"
//   이미지 첨부:   npm run post -- "글 내용" --image 사진.png
//   링크 카드:     npm run post -- "글 내용" --url https://주소
//   링크+썸네일:   npm run post -- "글 내용" --url https://주소 --image 썸네일.png
import fs from "node:fs";
import { apiVersion, TOKEN_FILE, type SavedToken } from "./config.js";

// 링크드인은 일부 특수문자를 글 서식 기호로 쓰기 때문에,
// 그냥 글자로 보이게 하려면 앞에 \ 를 붙여줘야 해요. (이걸 "이스케이프"라고 불러요)
function escapeText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, "\\$&");
}

function loadToken(): SavedToken {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error("먼저 `npm run login` 으로 로그인해주세요.");
  }
  const token = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8")) as SavedToken;
  if (Date.now() > token.expiresAt) {
    throw new Error(
      "출입증이 만료됐어요 (약 60일 유효). `npm run login` 을 다시 실행해주세요.",
    );
  }
  return token;
}

// 명령줄 입력 나누기: 글 내용과 --옵션들을 구분해요.
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

// 이미지 1장을 링크드인에 먼저 올려두고, 글에 붙일 수 있는 주소 번호(URN)를 받아와요.
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
    throw new Error(`이미지 업로드 준비 실패: ${initRes.status} ${await initRes.text()}`);
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
    throw new Error(`이미지 업로드 실패: ${putRes.status} ${await putRes.text()}`);
  }
  return value.image; // 예: urn:li:image:abc123
}

async function createPost(token: SavedToken, opts: PostOptions): Promise<string> {
  // 첨부 종류에 따라 글의 "내용물" 부분이 달라져요. 한 번에 한 종류만 붙일 수 있어요.
  let content: Record<string, unknown> | undefined;
  if (opts.url) {
    // 링크 카드: 본문은 외부 주소에 있고, 글에는 링크 카드만 붙어요.
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
      author: token.personUrn, // 누가 쓰는지 (나)
      commentary: escapeText(opts.text), // 글 내용
      visibility: "PUBLIC", // 전체 공개 (친구만: "CONNECTIONS")
      distribution: {
        feedDistribution: "MAIN_FEED", // 피드(메인 화면)에 노출
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      ...(content ? { content } : {}),
      lifecycleState: "PUBLISHED", // 바로 게시
      isReshareDisabledByAuthor: false,
    }),
  });

  // 성공하면 201 번호가 오고, 새 글의 주소 번호는 헤더(응답 머리말)에 들어 있어요.
  if (res.status !== 201) {
    throw new Error(`게시 실패: ${res.status} ${await res.text()}`);
  }
  return res.headers.get("x-restli-id") ?? "";
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.text && opts.images.length === 0 && !opts.url) {
    console.log('사용법: npm run post -- "올리고 싶은 글 내용" [--image 사진.png] [--url https://주소]');
    process.exit(1);
  }

  const token = loadToken();
  const postId = await createPost(token, opts);
  console.log("✅ 게시 완료!");
  console.log(`   https://www.linkedin.com/feed/update/${postId}/`);
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
