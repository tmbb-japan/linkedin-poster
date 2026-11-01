import "dotenv/config";

// .env 파일에서 값을 읽어오는 도우미. 값이 없으면 친절하게 알려줘요.
export function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `.env 파일에 ${name} 값이 없어요. .env.example을 참고해서 채워주세요.`,
    );
  }
  return value;
}

export const redirectUri =
  process.env.REDIRECT_URI ?? "http://localhost:3000/callback";
export const apiVersion = process.env.LINKEDIN_VERSION ?? "202608";

// 로그인 결과(출입증)를 저장해두는 파일 이름
export const TOKEN_FILE = ".token.json";

export interface SavedToken {
  accessToken: string; // 액세스 토큰(링크드인이 발급하는 임시 출입증)
  expiresAt: number; // 만료 시각 (밀리초 단위 시간값)
  personUrn: string; // 내 계정을 가리키는 고유 주소, 예: urn:li:person:abc123
}
