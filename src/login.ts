// 처음 한 번만 실행하는 "로그인" 스크립트.
// 브라우저에서 링크드인에 로그인하고 허락하면, 출입증(액세스 토큰)을 받아 .token.json에 저장해요.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import {
  required,
  redirectUri,
  TOKEN_FILE,
  type SavedToken,
} from "./config.js";

const clientId = required("LINKEDIN_CLIENT_ID");
const clientSecret = required("LINKEDIN_CLIENT_SECRET");

// state: 다른 사람이 끼어들지 못하게 확인하는 일회용 비밀 문자열
const state = crypto.randomBytes(16).toString("hex");

// 1) 사용자가 열어볼 링크드인 로그인 주소 만들기
const authUrl =
  "https://www.linkedin.com/oauth/v2/authorization?" +
  new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    // openid, profile: 내가 누구인지 확인 / w_member_social: 내 이름으로 글 쓰기
    scope: "openid profile w_member_social",
  }).toString();

// 2) 링크드인이 돌려준 "임시 코드"를 출입증(토큰)으로 교환하기
async function exchangeCodeForToken(code: string) {
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok)
    throw new Error(`토큰 교환 실패: ${res.status} ${await res.text()}`);
  return (await res.json()) as { access_token: string; expires_in: number };
}

// 3) 내 고유 번호(sub) 알아내기 → "urn:li:person:번호" 형태로 만들기
async function fetchPersonUrn(accessToken: string) {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok)
    throw new Error(`내 정보 조회 실패: ${res.status} ${await res.text()}`);
  const { sub } = (await res.json()) as { sub: string };
  return `urn:li:person:${sub}`;
}

// 내 컴퓨터에 작은 임시 서버를 열어서, 링크드인이 돌아오는 걸 기다려요.
const url = new URL(redirectUri);
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (reqUrl.pathname !== url.pathname) {
    res.writeHead(404).end("Not found");
    return;
  }

  try {
    if (reqUrl.searchParams.get("state") !== state)
      throw new Error("state 값이 달라요 (보안 검사 실패)");
    const code = reqUrl.searchParams.get("code");
    if (!code)
      throw new Error(
        `코드가 없어요: ${reqUrl.searchParams.get("error_description") ?? "알 수 없는 오류"}`,
      );

    const token = await exchangeCodeForToken(code);
    const personUrn = await fetchPersonUrn(token.access_token);

    const saved: SavedToken = {
      accessToken: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      personUrn,
    };
    // mode 0o600: 나만 읽고 쓸 수 있게 (비밀번호처럼 다뤄야 해요)
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(saved, null, 2), {
      mode: 0o600,
    });

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>로그인 완료! 이 창을 닫고 터미널로 돌아가세요.</h2>");
    console.log(`✅ 로그인 성공! ${TOKEN_FILE} 에 저장했어요.`);
    console.log(
      `   유효기간: ${new Date(saved.expiresAt).toLocaleDateString("ko-KR")} 까지`,
    );
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(String(err));
    console.error("❌", err);
  } finally {
    server.close();
  }
});

server.listen(Number(url.port) || 80, () => {
  console.log(
    "아래 주소를 브라우저에 붙여넣어 링크드인에 로그인하고 '허용'을 눌러주세요:\n",
  );
  console.log(authUrl + "\n");
});
