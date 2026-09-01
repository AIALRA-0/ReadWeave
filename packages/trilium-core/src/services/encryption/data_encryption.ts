import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { getLog } from "../log.js";
import { concat2, decodeBase64, decodeUtf8, encodeBase64, encodeUtf8 } from "../utils/binary.js";
import { getCrypto } from "./crypto.js";

const AUTHENTICATED_ENCRYPTION_PREFIX = "v2:";
const AUTHENTICATED_ENCRYPTION_SALT_LENGTH = 16;
const AUTHENTICATED_ENCRYPTION_IV_LENGTH = 12;
const AUTHENTICATED_ENCRYPTION_TAG_LENGTH = 16;
const AUTHENTICATED_ENCRYPTION_INFO = encodeUtf8("trilium-data-encryption-v2");

function arraysIdentical(a: any[] | Uint8Array, b: any[] | Uint8Array) {
    let i = a.length;
    if (i !== b.length) return false;
    while (i--) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function shaArray(content: string | Uint8Array) {
    // we use this as a simple checksum and don't rely on its security, so SHA-1 is good enough
    return getCrypto().createHash("sha1", content);
}

function pad(data: Uint8Array): Uint8Array {
    if (data.length > 16) {
        data = data.slice(0, 16);
    } else if (data.length < 16) {
        const zeros = Array(16 - data.length).fill(0);

        data = concat2(data, Uint8Array.from(zeros));
    }

    return Uint8Array.from(data);
}

function deriveAuthenticatedEncryptionKey(key: Uint8Array, salt: Uint8Array) {
    return hkdf(sha256, key, salt, AUTHENTICATED_ENCRYPTION_INFO, 32);
}

function encrypt(key: Uint8Array, plainText: Uint8Array | string) {
    if (!key) {
        throw new Error("No data key!");
    }

    const plainTextUint8Array = ArrayBuffer.isView(plainText) ? plainText : encodeUtf8(plainText);

    const salt = getCrypto().randomBytes(AUTHENTICATED_ENCRYPTION_SALT_LENGTH);
    const iv = getCrypto().randomBytes(AUTHENTICATED_ENCRYPTION_IV_LENGTH);
    const encryptedWithTag = gcm(deriveAuthenticatedEncryptionKey(key, salt), iv).encrypt(plainTextUint8Array);
    const encryptedData = encryptedWithTag.slice(0, -AUTHENTICATED_ENCRYPTION_TAG_LENGTH);
    const authTag = encryptedWithTag.slice(-AUTHENTICATED_ENCRYPTION_TAG_LENGTH);
    const payload = concat2(concat2(concat2(salt, iv), authTag), encryptedData);

    return `${AUTHENTICATED_ENCRYPTION_PREFIX}${encodeBase64(payload)}`;
}

function decrypt(key: Uint8Array, cipherText: string | Uint8Array): Uint8Array | false | null {
    if (cipherText === null) {
        return null;
    }

    if (!key) {
        return encodeUtf8("[protected]");
    }

    const cipherTextStr = typeof cipherText === "string" ? cipherText : decodeUtf8(cipherText);

    try {
        if (cipherTextStr.startsWith(AUTHENTICATED_ENCRYPTION_PREFIX)) {
            const payload = decodeBase64(cipherTextStr.slice(AUTHENTICATED_ENCRYPTION_PREFIX.length));
            const authenticatedHeaderLength = AUTHENTICATED_ENCRYPTION_SALT_LENGTH
                + AUTHENTICATED_ENCRYPTION_IV_LENGTH
                + AUTHENTICATED_ENCRYPTION_TAG_LENGTH;
            if (payload.length < authenticatedHeaderLength) {
                return false;
            }

            const salt = payload.slice(0, AUTHENTICATED_ENCRYPTION_SALT_LENGTH);
            const iv = payload.slice(
                AUTHENTICATED_ENCRYPTION_SALT_LENGTH,
                AUTHENTICATED_ENCRYPTION_SALT_LENGTH + AUTHENTICATED_ENCRYPTION_IV_LENGTH
            );
            const authTag = payload.slice(
                AUTHENTICATED_ENCRYPTION_SALT_LENGTH + AUTHENTICATED_ENCRYPTION_IV_LENGTH,
                authenticatedHeaderLength
            );
            const encryptedData = payload.slice(authenticatedHeaderLength);
            return gcm(deriveAuthenticatedEncryptionKey(key, salt), iv).decrypt(concat2(encryptedData, authTag));
        }

        // Backward-compatible decryption for values written by earlier
        // Trilium releases. New writes always use authenticated AES-GCM.
        const cipherTextUint8ArrayWithIv = decodeBase64(cipherTextStr);

        // old encrypted data can have IV of length 13, see some details here: https://github.com/zadam/trilium/issues/3017
        const ivLength = cipherTextUint8ArrayWithIv.length % 16 === 0 ? 16 : 13;

        const iv = cipherTextUint8ArrayWithIv.slice(0, ivLength);

        const cipherTextUint8Array = cipherTextUint8ArrayWithIv.slice(ivLength);

        const decipher = getCrypto().createDecipheriv("aes-128-cbc", pad(key), pad(iv));

        const decryptedBytes = concat2(decipher.update(cipherTextUint8Array), decipher.final());

        const digest = decryptedBytes.slice(0, 4);
        const payload = decryptedBytes.slice(4);

        const computedDigest = shaArray(payload).slice(0, 4);

        if (!arraysIdentical(digest, computedDigest)) {
            return false;
        }

        return payload;
    } catch (e: any) {
        if (cipherTextStr.startsWith(AUTHENTICATED_ENCRYPTION_PREFIX)) {
            return false;
        }

        // recovery from https://github.com/zadam/trilium/issues/510
        if (e.message?.includes("WRONG_FINAL_BLOCK_LENGTH") || e.message?.includes("wrong final block length")) {
            getLog().info("Caught WRONG_FINAL_BLOCK_LENGTH, returning cipherText instead");

            return (ArrayBuffer.isView(cipherText) ? cipherText : encodeUtf8(cipherText));
        }
        throw e;
    }
}

function decryptString(dataKey: Uint8Array, cipherText: string) {
    const buffer = decrypt(dataKey, cipherText);

    if (buffer === null) {
        return null;
    } else if (buffer === false) {
        getLog().error(`Could not decrypt string. Uint8Array: ${buffer}`);

        throw new Error("Could not decrypt string.");
    }

    return decodeUtf8(buffer);
}

export default {
    encrypt,
    decrypt,
    decryptString
};
