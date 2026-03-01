import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anon);

// ✅ 유저별 기본 목표 재고 설정 (profiles)
export type Profile = {
  user_id: string;
  default_target_qty: number;
  low_stock_threshold: number;
  is_invited?: boolean; // ✅ 초대 통과 여부(InviteGate 통과에 필요)
};

export async function getOrCreateMyProfile() {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = authData.user;
  if (!user) throw new Error("No authenticated user");

  // 1) 먼저 내 profile 조회
  const { data: profile, error: selErr } = await supabase
    .from("profiles")
    .select("user_id, default_target_qty, low_stock_threshold, is_invited") // ✅ is_invited 포함
    .eq("user_id", user.id)
    .maybeSingle();

  if (selErr) throw selErr;

  // 2) 없으면 생성
  if (!profile) {
    const { data: created, error: insErr } = await supabase
      .from("profiles")
      .insert({ user_id: user.id })
      .select("user_id, default_target_qty, low_stock_threshold, is_invited") // ✅ is_invited 포함
      .single();

    if (insErr) throw insErr;
    return created as Profile;
  }

  return profile as Profile;
}

export async function updateMyDefaultTargetQty(value: number) {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = authData.user;
  if (!user) throw new Error("No authenticated user");

  const safe = Math.max(0, Math.min(9999, Math.floor(value)));

  const { data, error } = await supabase
    .from("profiles")
    .update({ default_target_qty: safe })
    .eq("user_id", user.id)
    .select("user_id, default_target_qty, low_stock_threshold, is_invited") // ✅ is_invited 포함
    .single();

  if (error) throw error;
  return data as Profile;
}

export async function updateMyLowStockThreshold(value: number) {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = authData.user;
  if (!user) throw new Error("No authenticated user");

  const safe = Math.max(0, Math.min(9999, Math.floor(value)));

  const { data, error } = await supabase
    .from("profiles")
    .update({ low_stock_threshold: safe })
    .eq("user_id", user.id)
    .select("user_id, default_target_qty, low_stock_threshold, is_invited") // ✅ is_invited 포함
    .single();

  if (error) throw error;
  return data as Profile;
}
// =======================
// 마진 계산기: DB 저장용
// =======================

export type MarginProductRow = {
  id: string
  user_id: string
  name: string
  memo: string | null
  data: any
  created_at: string
  updated_at: string
}

export type MaterialLibraryRow = {
  id: string
  user_id: string
  name: string
  unit_price: number
  created_at: string
  updated_at: string
}

export async function listMyMarginProducts() {
  const { data: authData, error: authErr } = await supabase.auth.getUser()
  if (authErr) throw authErr
  const user = authData.user
  if (!user) throw new Error("No authenticated user")

    const { data, error } = await supabase
    .from("margin_products")
    .select("id,user_id,name,memo,data,created_at,updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })

  if (error) throw error
  return (data ?? []) as MarginProductRow[]
}

export async function upsertMyMarginProduct(input: {
  id?: string
  name: string
  memo?: string
  data: any
}) {
  const { data: authData, error: authErr } = await supabase.auth.getUser()
  if (authErr) throw authErr
  const user = authData.user
  if (!user) throw new Error("No authenticated user")

  const payload: any = {
    user_id: user.id,
    name: input.name,
    memo: input.memo ?? null,
    data: input.data ?? {},
  }
  if (input.id) payload.id = input.id

  const { data, error } = await supabase
    .from("margin_products")
    .upsert(payload)
    .select("id,user_id,name,memo,data,created_at,updated_at")
    .single()

  if (error) throw error
  return data as MarginProductRow
}

export async function deleteMyMarginProduct(id: string) {
  const { data: authData, error: authErr } = await supabase.auth.getUser()
  if (authErr) throw authErr
  const user = authData.user
  if (!user) throw new Error("No authenticated user")

  const { error } = await supabase
    .from("margin_products")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)

  if (error) throw error
}

export async function listMyMaterialLibrary() {
  const { data: authData, error: authErr } = await supabase.auth.getUser()
  if (authErr) throw authErr
  const user = authData.user
  if (!user) throw new Error("No authenticated user")

  const { data, error } = await supabase
    .from("material_library")
    .select("id,user_id,name,unit_price,created_at,updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })

  if (error) throw error
  return (data ?? []) as MaterialLibraryRow[]
}

// 동일 이름이면 갱신, 없으면 생성(유니크 인덱스 기반)
export async function upsertMyMaterialLibraryItem(input: {
  name: string
  unitPrice: number
}) {
  const { data: authData, error: authErr } = await supabase.auth.getUser()
  if (authErr) throw authErr
  const user = authData.user
  if (!user) throw new Error("No authenticated user")

  const name = (input.name ?? "").toString().trim()
  const unit_price = Math.max(0, Number(input.unitPrice) || 0)

  // 1) 먼저 존재하면 update
  const { data: existing, error: selErr } = await supabase
    .from("material_library")
    .select("id")
    .eq("user_id", user.id)
    .ilike("name", name) // 대소문자 무시(근사)
    .maybeSingle()

  if (selErr) throw selErr

  if (existing?.id) {
    const { data, error } = await supabase
      .from("material_library")
      .update({ unit_price })
      .eq("id", existing.id)
      .eq("user_id", user.id)
      .select("id,user_id,name,unit_price,created_at,updated_at")
      .single()

    if (error) throw error
    return data as MaterialLibraryRow
  }

  // 2) 없으면 insert
  const { data, error } = await supabase
    .from("material_library")
    .insert({ user_id: user.id, name, unit_price })
    .select("id,user_id,name,unit_price,created_at,updated_at")
    .single()

  if (error) throw error
  return data as MaterialLibraryRow
}

export async function deleteMyMaterialLibraryItem(id: string) {
  const { data: authData, error: authErr } = await supabase.auth.getUser()
  if (authErr) throw authErr
  const user = authData.user
  if (!user) throw new Error("No authenticated user")

  const { error } = await supabase
    .from("material_library")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)

  if (error) throw error
}
