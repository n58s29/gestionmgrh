// ═══ MGRH Supabase Configuration ═══
// Supabase (PostgreSQL) as persistent data store for members & events
//
// SETUP INSTRUCTIONS:
// 1. Go to https://supabase.com → New Project
// 2. Note your project URL and anon (public) key from Settings → API
// 3. Create the table via SQL Editor (see below)
// 4. Enable Realtime on the table
//
// SQL to run in Supabase SQL Editor:
//
//   CREATE TABLE app_data (
//     id TEXT PRIMARY KEY DEFAULT 'mgrh-main',
//     members JSONB DEFAULT '[]'::jsonb,
//     events JSONB DEFAULT '[]'::jsonb,
//     last_modified TIMESTAMPTZ DEFAULT now(),
//     last_modified_by TEXT DEFAULT 'system'
//   );
//
//   -- Insert initial empty row
//   INSERT INTO app_data (id) VALUES ('mgrh-main');
//
//   -- Enable Realtime
//   ALTER PUBLICATION supabase_realtime ADD TABLE app_data;
//
//   -- Row Level Security (open access, or restrict as needed)
//   ALTER TABLE app_data ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "Allow all" ON app_data FOR ALL USING (true) WITH CHECK (true);

// ──── SUPABASE CONFIG (REPLACE WITH YOUR VALUES) ────
const SUPABASE_URL = 'https://pjcypcbysnazgvtfjkjy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_TVQL-_urEdrZUmspauQhWQ_cT1clqSp';

// ──── SUPABASE INIT ────
let supabaseClient = null;
let supabaseReady = false;
let realtimeChannel = null;

const DOC_ID = 'mgrh-main';

function initSupabase() {
  // Initialize Supabase client
  // Creates Supabase client instance
  try {
    if (typeof supabase === 'undefined') {
      console.error('Supabase SDK not loaded');
      return false;
    }
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    supabaseReady = true;
    console.log('Supabase initialized');
    return true;
  } catch (err) {
    console.error('Supabase init error:', err);
    return false;
  }
}

// ──── SUPABASE DATA OPERATIONS ────

async function loadData() {
  if (!supabaseReady) return null;
  try {
    const { data: row, error } = await supabaseClient
      .from('app_data')
      .select('members, events')
      .eq('id', DOC_ID)
      .single();

    if (error) {
      // Row doesn't exist yet — that's fine
      if (error.code === 'PGRST116') return null;
      console.error('Supabase load error:', error);
      return null;
    }
    return row;
  } catch (err) {
    console.error('Supabase load error:', err);
    return null;
  }
}

async function saveData(data) {
  if (!supabaseReady) return false;
  try {
    const { error } = await supabaseClient
      .from('app_data')
      .upsert({
        id: DOC_ID,
        members: data.members || [],
        events: data.events || [],
        last_modified: new Date().toISOString(),
        last_modified_by: sessionStorage.getItem('mgrh-user') || 'unknown'
      });

    if (error) {
      console.error('Supabase save error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Supabase save error:', err);
    return false;
  }
}

async function seedData(seedData) {
  if (!supabaseReady) return false;
  try {
    // Check if row exists
    const existing = await loadData();
    if (existing) return false; // Already has data

    const { error } = await supabaseClient
      .from('app_data')
      .upsert({
        id: DOC_ID,
        members: seedData.members || [],
        events: seedData.events || [],
        last_modified: new Date().toISOString(),
        last_modified_by: 'seed'
      });

    if (error) {
      console.error('Supabase seed error:', error);
      return false;
    }
    console.log('Seed data written to Supabase');
    return true;
  } catch (err) {
    console.error('Supabase seed error:', err);
    return false;
  }
}

// ──── REAL-TIME LISTENER ────

function startRealtimeListener(onDataChange) {
  if (!supabaseReady) return;
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabaseClient
    .channel('app_data_changes')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'app_data', filter: `id=eq.${DOC_ID}` },
      (payload) => {
        if (payload.new && onDataChange) {
          onDataChange(payload.new);
        }
      }
    )
    .subscribe((status) => {
      console.log('Realtime status:', status);
    });
}

function stopRealtimeListener() {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}
