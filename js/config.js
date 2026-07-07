// ── Supabase 연결 설정 ──────────────────────────────
// anon(publishable) key는 공개되어도 RLS로 보호됩니다 (쓰기는 로그인 사용자만).
const CONFIG = {
  SUPABASE_URL: "https://pbcuhicquppaveibkuya.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_5qOWh94W0UibE9eFU4crlg_GipJmVXG",
  AUTH_DOMAIN: "hmcm.local", // 사번@hmcm.local 형태로 인증
  TEAM: ["강지영", "황선필", "강상구", "박상원", "이민지", "조선두"],
  USERS: {
    b22042: { name: "조선두", role: "master" },
    b21320: { name: "강지영", role: "normal" },
    b21368: { name: "황선필", role: "normal" },
    b22004: { name: "강상구", role: "normal" },
    b24054: { name: "이민지", role: "normal" },
    b25036: { name: "박상원", role: "normal" },
  },
};
