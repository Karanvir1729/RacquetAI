import { createClient } from "@supabase/supabase-js";

/**
 * The Supabase client. The URL and publishable key are safe to ship in a
 * browser bundle by design (row-level security is the actual gate), and the
 * committed defaults keep `npm run dev` working with zero setup; both can be
 * overridden per-build via VITE_SUPABASE_URL / VITE_SUPABASE_KEY.
 */
const SUPABASE_URL: string =
  typeof import.meta.env.VITE_SUPABASE_URL === "string" &&
  import.meta.env.VITE_SUPABASE_URL.length > 0
    ? import.meta.env.VITE_SUPABASE_URL
    : "https://olljogfjesovpfjxraxf.supabase.co";

const SUPABASE_KEY: string =
  typeof import.meta.env.VITE_SUPABASE_KEY === "string" &&
  import.meta.env.VITE_SUPABASE_KEY.length > 0
    ? import.meta.env.VITE_SUPABASE_KEY
    : "sb_publishable_Hj6dRUv2c0lPSUo81HFE0g_HSDk5mGd";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
