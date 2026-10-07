import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import "./config.js";

const c = window.SNACK_VAULT_CONFIG;

export const supabase = createClient(
  c.SUPABASE_URL,
  c.SUPABASE_ANON_KEY
);

export async function getCreator(slug) {
  const { data, error } = await supabase
    .from("creators")
    .select("id,slug,name,accent_color")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getSnacks(id) {
  const { data, error } = await supabase
    .from("snacks")
    .select("id,name,description,image_url,rarity,category,weight")
    .eq("creator_id", id)
    .eq("enabled", true)
    .eq("archived", false)
    .order("created_at");

  if (error) throw error;
  return data || [];
}

export async function getCollection(id, user) {
  const { data, error } = await supabase.rpc("get_public_collection", {
    p_creator_id: id,
    p_username: user
  });

  if (error) throw error;
  return data;
}

export async function getLeaderboard(id) {
  const { data, error } = await supabase
    .from("leaderboard")
    .select("display_name,unique_snacks,total_snacks")
    .eq("creator_id", id)
    .order("unique_snacks", { ascending: false })
    .order("total_snacks", { ascending: false })
    .limit(25);

  if (error) throw error;
  return data || [];
}
// Backwards-compatible names used by the current website
export const creator = getCreator;
export const snacks = getSnacks;
export const collection = getCollection;
export const leaderboard = getLeaderboard;
