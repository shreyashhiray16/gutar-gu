/**
 * Gutar GU - Client-Side E2EE Engine
 * Using Web Crypto API:
 * 1. ECDH (P-256) key-pair generation
 * 2. Raw public key export / import for exchange
 * 3. AES-GCM-256 derivation via HKDF / direct ECDH deriveKey
 * 4. Symmetric encryption & decryption (random 12-byte IV per message)
 * 5. In-memory only: zero keys persisted to localStorage or cookies
 */
class E2EEngine {
  constructor() {
    this.keyPair = null;
    this.sharedKey = null;
    this.isReady = false;
  }

  // Generate ECDH P-256 key pair
  async init() {
    if (!window.crypto || !window.crypto.subtle) {
      console.warn("Web Crypto API not available. E2EE disabled.");
      return null;
    }
    this.keyPair = await window.crypto.subtle.generateKey(
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      false, // non-extractable private key
      ["deriveKey", "deriveBits"]
    );

    // Export public key as JWK or raw bytes (Array) for transmission
    const exportedRaw = await window.crypto.subtle.exportKey("raw", this.keyPair.publicKey);
    return Array.from(new Uint8Array(exportedRaw));
  }

  // Compute shared secret using partner's raw public key
  async setPartnerKey(partnerRawArray) {
    if (!this.keyPair || !window.crypto || !window.crypto.subtle) return false;
    try {
      const rawBytes = new Uint8Array(partnerRawArray);
      const partnerPublicKey = await window.crypto.subtle.importKey(
        "raw",
        rawBytes,
        {
          name: "ECDH",
          namedCurve: "P-256"
        },
        false,
        []
      );

      // Derive AES-GCM 256-bit key
      this.sharedKey = await window.crypto.subtle.deriveKey(
        {
          name: "ECDH",
          public: partnerPublicKey
        },
        this.keyPair.privateKey,
        {
          name: "AES-GCM",
          length: 256
        },
        false,
        ["encrypt", "decrypt"]
      );

      this.isReady = true;
      return true;
    } catch (e) {
      console.error("Failed to derive shared key", e);
      return false;
    }
  }

  // Encrypt plaintext string -> { ciphertext: [bytes], iv: [bytes] }
  async encrypt(plaintext) {
    if (!this.isReady || !this.sharedKey) {
      return { encrypted: false, text: plaintext };
    }
    try {
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(plaintext);
      const cipherBuffer = await window.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: iv
        },
        this.sharedKey,
        encoded
      );

      return {
        encrypted: true,
        cipherBytes: Array.from(new Uint8Array(cipherBuffer)),
        iv: Array.from(iv)
      };
    } catch (err) {
      console.error("Encryption failed:", err);
      return { encrypted: false, text: plaintext };
    }
  }

  // Decrypt cipherBytes + iv -> plaintext string
  async decrypt(cipherBytes, ivBytes) {
    if (!this.isReady || !this.sharedKey) {
      return "[Encrypted message - key mismatch]";
    }
    try {
      const cipherArray = new Uint8Array(cipherBytes);
      const iv = new Uint8Array(ivBytes);
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv
        },
        this.sharedKey,
        cipherArray
      );
      return new TextDecoder().decode(decryptedBuffer);
    } catch (err) {
      console.error("Decryption failed:", err);
      return "[Decryption error]";
    }
  }

  // Reset keys on leave/wipe
  destroy() {
    this.keyPair = null;
    this.sharedKey = null;
    this.isReady = false;
  }
}

// Global instance
window.E2EE = new E2EEngine();
