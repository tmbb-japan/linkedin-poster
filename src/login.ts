// 最初に一度だけ実行する「ログイン」スクリプト。
// ブラウザでLinkedInにログインして許可すると、アクセストークンを受け取って .token.json に保存する。
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

// state: 他人が割り込めないように確認する、使い捨ての秘密文字列
const state = crypto.randomBytes(16).toString("hex");

// 1) ユーザーが開くLinkedInのログインURLを作る
const authUrl =
  "https://www.linkedin.com/oauth/v2/authorization?" +
  new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    // openid, profile: 自分が誰かを確認 / w_member_social: 自分の名前で投稿する
    scope: "openid profile w_member_social",
  }).toString();

// 2) LinkedInが返した「一時コード」をアクセストークンに交換する
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
    throw new Error(`トークン交換に失敗: ${res.status} ${await res.text()}`);
  return (await res.json()) as { access_token: string; expires_in: number };
}

// 3) 自分の固有番号（sub）を調べる → 「urn:li:person:番号」の形にする
async function fetchPersonUrn(accessToken: string) {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok)
    throw new Error(`自分の情報の取得に失敗: ${res.status} ${await res.text()}`);
  const { sub } = (await res.json()) as { sub: string };
  return `urn:li:person:${sub}`;
}

// 自分のコンピュータに小さな一時サーバーを開いて、LinkedInが戻ってくるのを待つ。
const url = new URL(redirectUri);
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (reqUrl.pathname !== url.pathname) {
    res.writeHead(404).end("Not found");
    return;
  }

  try {
    if (reqUrl.searchParams.get("state") !== state)
      throw new Error("stateの値が違います（セキュリティ検査に失敗）");
    const code = reqUrl.searchParams.get("code");
    if (!code)
      throw new Error(
        `コードがありません: ${reqUrl.searchParams.get("error_description") ?? "不明なエラー"}`,
      );

    const token = await exchangeCodeForToken(code);
    const personUrn = await fetchPersonUrn(token.access_token);

    const saved: SavedToken = {
      accessToken: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      personUrn,
    };
    // mode 0o600: 自分だけが読み書きできるようにする（パスワードのように扱うこと）
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(saved, null, 2), {
      mode: 0o600,
    });

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>ログイン完了！この画面を閉じてターミナルに戻ってください。</h2>");
    console.log(`✅ ログイン成功！ ${TOKEN_FILE} に保存しました。`);
    console.log(
      `   有効期限: ${new Date(saved.expiresAt).toLocaleDateString("ja-JP")} まで`,
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
    "下のURLをブラウザに貼って、LinkedInにログインして「許可」を押してください:\n",
  );
  console.log(authUrl + "\n");
});
