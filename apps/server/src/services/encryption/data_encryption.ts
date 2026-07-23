import crypto from "crypto";
import log from "../log.js";

const AUTHENTICATED_ENCRYPTION_PREFIX = "v2:";

function arraysIdentical(a: any[] | Buffer, b: any[] | Buffer) {
    let i = a.length;
    if (i !== b.length) return false;
    while (i--) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function shaArray(content: crypto.BinaryLike) {
    // we use this as a simple checksum and don't rely on its security, so SHA-1 is good enough
    return crypto.createHash("sha1").update(content).digest();
}

function pad(data: Buffer): Buffer {
    if (data.length > 16) {
        data = data.slice(0, 16);
    } else if (data.length < 16) {
        const zeros = Array(16 - data.length).fill(0);

        data = Buffer.concat([data, Buffer.from(zeros)]);
    }

    return Buffer.from(data);
}

function deriveAuthenticatedEncryptionKey(key: Buffer) {
    return crypto.createHash("sha256").update(key).digest();
}

function encrypt(key: Buffer, plainText: Buffer | string) {
    if (!key) {
        throw new Error("No data key!");
    }

    const plainTextBuffer = Buffer.isBuffer(plainText) ? plainText : Buffer.from(plainText);

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", deriveAuthenticatedEncryptionKey(key), iv);
    const encryptedData = Buffer.concat([cipher.update(plainTextBuffer), cipher.final()]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), encryptedData]);

    return `${AUTHENTICATED_ENCRYPTION_PREFIX}${payload.toString("base64")}`;
}

function decrypt(key: Buffer, cipherText: string | Buffer): Buffer | false | null {
    if (cipherText === null) {
        return null;
    }

    if (!key) {
        return Buffer.from("[protected]");
    }

    const encodedCipherText = cipherText.toString();

    try {
        if (encodedCipherText.startsWith(AUTHENTICATED_ENCRYPTION_PREFIX)) {
            const payload = Buffer.from(encodedCipherText.slice(AUTHENTICATED_ENCRYPTION_PREFIX.length), "base64");
            if (payload.length < 28) {
                return false;
            }

            const iv = payload.subarray(0, 12);
            const authTag = payload.subarray(12, 28);
            const encryptedData = payload.subarray(28);
            const decipher = crypto.createDecipheriv("aes-256-gcm", deriveAuthenticatedEncryptionKey(key), iv);
            decipher.setAuthTag(authTag);

            return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
        }

        // Backward-compatible decryption for data written by earlier Trilium
        // releases. New writes always use authenticated AES-256-GCM above.
        const cipherTextBufferWithIv = Buffer.from(encodedCipherText, "base64");

        // old encrypted data can have IV of length 13, see some details here: https://github.com/zadam/trilium/issues/3017
        const ivLength = cipherTextBufferWithIv.length % 16 === 0 ? 16 : 13;

        const iv = cipherTextBufferWithIv.slice(0, ivLength);

        const cipherTextBuffer = cipherTextBufferWithIv.slice(ivLength);

        const decipher = crypto.createDecipheriv("aes-128-cbc", pad(key), pad(iv));

        const decryptedBytes = Buffer.concat([decipher.update(cipherTextBuffer), decipher.final()]);

        const digest = decryptedBytes.slice(0, 4);
        const payload = decryptedBytes.slice(4);

        const computedDigest = shaArray(payload).slice(0, 4);

        if (!arraysIdentical(digest, computedDigest)) {
            return false;
        }

        return payload;
    } catch (e: any) {
        if (encodedCipherText.startsWith(AUTHENTICATED_ENCRYPTION_PREFIX)) {
            return false;
        }

        // recovery from https://github.com/zadam/trilium/issues/510
        if (e.message?.includes("WRONG_FINAL_BLOCK_LENGTH") || e.message?.includes("wrong final block length")) {
            log.info("Caught WRONG_FINAL_BLOCK_LENGTH, returning cipherText instead");

            return (Buffer.isBuffer(cipherText) ? cipherText : Buffer.from(cipherText));
        } else {
            throw e;
        }
    }
}

function decryptString(dataKey: Buffer, cipherText: string) {
    const buffer = decrypt(dataKey, cipherText);

    if (buffer === null) {
        return null;
    } else if (buffer === false) {
        log.error(`Could not decrypt string. Buffer: ${buffer}`);

        throw new Error("Could not decrypt string.");
    }

    return buffer.toString("utf-8");
}

export default {
    encrypt,
    decrypt,
    decryptString
};
