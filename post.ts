// 사용법:  npm run post -- "올리고 싶은 글 내용"
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

async function createPost(token: SavedToken, text: string): Promise<string> {
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
      commentary: escapeText(text), // 글 내용
      visibility: "PUBLIC", // 전체 공개 (친구만: "CONNECTIONS")
      distribution: {
        feedDistribution: "MAIN_FEED", // 피드(메인 화면)에 노출
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
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
  const text = process.argv.slice(2).join(" ").trim();
  if (!text) {
    console.log('사용법: npm run post -- "올리고 싶은 글 내용"');
    process.exit(1);
  }

  const token = loadToken();
  const postId = await createPost(token, text);
  console.log("✅ 게시 완료!");
  console.log(`   https://www.linkedin.com/feed/update/${postId}/`);
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
