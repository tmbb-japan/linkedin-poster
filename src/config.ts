import "dotenv/config";

// .envファイルから値を読み取るヘルパー。値がなければ分かりやすく知らせる。
export function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `.envファイルに ${name} の値がありません。.env.exampleを参考に入力してください。`,
    );
  }
  return value;
}

export const redirectUri =
  process.env.REDIRECT_URI ?? "http://localhost:3000/callback";
export const apiVersion = process.env.LINKEDIN_VERSION ?? "202608";

// ログイン結果（アクセストークン）を保存しておくファイル名
export const TOKEN_FILE = ".token.json";

export interface SavedToken {
  accessToken: string; // アクセストークン（LinkedInが発行する一時的な入場証）
  expiresAt: number; // 有効期限の時刻（ミリ秒単位の時間値）
  personUrn: string; // 自分のアカウントを指す固有のアドレス。例: urn:li:person:abc123
}
