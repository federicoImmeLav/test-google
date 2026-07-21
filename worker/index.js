import { jwtVerify, createRemoteJWKSet } from "jose";

const SCHOOL_DOMAIN = "immaginazioneelavoro.it";

// Deve combaciare esattamente con l'origine (schema+host), senza il path
const FRONTEND_ORIGIN = "https://federicoimmelav.github.io";

const CLIENT_ID = "618251455080-vr1d5440vm2ifmp7p8voo9hec56avc2q.apps.googleusercontent.com";

const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 ore, va bene per un test

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": FRONTEND_ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function base64urlEncode(bytes) {
  let str = btoa(String.fromCharCode(...bytes));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signSession(payload, secret) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const payloadPart = base64urlEncode(payloadBytes);
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart));
  const signaturePart = base64urlEncode(new Uint8Array(signature));
  return `${payloadPart}.${signaturePart}`;
}

async function verifySession(cookieValue, secret) {
  const [payloadPart, signaturePart] = cookieValue.split(".");
  if (!payloadPart || !signaturePart) return null;

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64urlDecode(signaturePart),
    new TextEncoder().encode(payloadPart)
  );
  if (!valid) return null;

  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadPart)));
  if (payload.exp < Date.now() / 1000) return null;

  return payload;
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? match[1] : null;
}

async function handleVerify(request, env) {
  const { credential } = await request.json();
  if (!credential) {
    return new Response("Missing credential", { status: 400, headers: corsHeaders() });
  }

  let payload;
  try {
    const result = await jwtVerify(credential, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: CLIENT_ID
    });
    payload = result.payload;
  } catch (err) {
    return new Response("Invalid token", { status: 401, headers: corsHeaders() });
  }

  if (payload.hd !== SCHOOL_DOMAIN) {
    return new Response("Wrong domain", { status: 403, headers: corsHeaders() });
  }

  const sessionValue = await signSession(
    { email: payload.email, hd: payload.hd, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS },
    env.WORKER_SECRET
  );

  const headers = new Headers(corsHeaders());
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sessionValue}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${SESSION_TTL_SECONDS}`
  );
  return new Response("OK", { status: 200, headers });
}

async function handleSession(request, env) {
  const cookieValue = getCookie(request, SESSION_COOKIE);
  const headers = new Headers(corsHeaders());
  headers.set("Content-Type", "application/json");

  if (!cookieValue) {
    return new Response(JSON.stringify({ authenticated: false }), { status: 200, headers });
  }

  const session = await verifySession(cookieValue, env.WORKER_SECRET);
  const authenticated = !!session && session.hd === SCHOOL_DOMAIN;
  return new Response(JSON.stringify({ authenticated }), { status: 200, headers });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);

    if (url.pathname === "/verify" && request.method === "POST") {
      return handleVerify(request, env);
    }

    if (url.pathname === "/session" && request.method === "GET") {
      return handleSession(request, env);
    }

    return new Response("Not found", { status: 404, headers: corsHeaders() });
  }
};
