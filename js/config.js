// Gravity SandBox — global configuration
// The URL and key below are PUBLIC by design (Supabase "anon" key). Data is protected by
// Row Level Security rules in the database. Never put the secret/service key here.
export const SUPABASE_URL = 'https://mhtxnmknuexraimyrjtq.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1odHhubWtudWV4cmFpbXlyanRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NDU2MjUsImV4cCI6MjEwODMyMTYyNX0.hRiqPiC4Io6lywMulAyH8FN0huk5pFjCuw_5dLB86O8';

// Public website. Invite/map links and auth e-mails always point here, also from the desktop app
// (which runs from a private app:// address that nobody else can open).
export const SITE_URL = 'https://sandbox-gravity.netlify.app';
export const PUBLIC_URL = /^https?:$/.test(location.protocol) ? location.origin : SITE_URL;

export const GAME_NAME = 'Gravity SandBox';
export const VERSION = '1.1.0';

export const G_EARTH = 9.81;          // m/s²
export const MAX_G = 10;              // max gravity strength in g
export const MAX_OBJECTS = 100;       // dynamic objects per map
export const MAX_STATICS = 400;       // static pieces per map (editor)
export const MAX_PLAYERS = 5;
export const MAX_BUBBLES = 12;
export const MAX_LINKS = 20;
export const TK_LIMIT_KG = 350;       // telekinesis lifting limit (effective kg at 1 g)
export const PHYSICS_HZ = 120;        // physics substep rate (2 substeps per 60 fps frame)
export const NET_HZ = 20;             // snapshots per second
export const INTERP_DELAY = 0.1;      // seconds of client-side smoothing buffer

export const PLAYER = {
  height: 1.8, radius: 0.32, eye: 0.68, mass: 75,
  walk: 5, sprint: 8.5, crouch: 2.4, jump: 5.2,
};

// Free public STUN servers for WebRTC peer-to-peer
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export const COLORS = {
  gravity: 0x35d0e6,   // cyan: gravity powers
  tk: 0xff7a5c,        // coral: telekinesis
  accent: 0xf28c28,
};

export const PLAYER_COLORS = ['#4fc3d9', '#f28c28', '#9b7cf2', '#5cc46a', '#ef5b7a', '#f2d23c', '#e8e8e8', '#3a5ba8'];
