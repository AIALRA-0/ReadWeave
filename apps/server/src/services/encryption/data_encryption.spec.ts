import { describe, expect, it } from "vitest";

import dataEncryption from "./data_encryption.js";

describe("data encryption", () => {
    const key = Buffer.from("test-data-encryption-key");

    it("uses authenticated encryption for new data", () => {
        const encrypted = dataEncryption.encrypt(key, "sensitive value");

        expect(encrypted).toMatch(/^v2:/);
        expect(dataEncryption.decryptString(key, encrypted)).toBe("sensitive value");
    });

    it("rejects modified authenticated ciphertext", () => {
        const encrypted = dataEncryption.encrypt(key, "sensitive value");
        const payload = Buffer.from(encrypted.slice("v2:".length), "base64");
        payload[payload.length - 1] ^= 1;

        expect(dataEncryption.decrypt(key, `v2:${payload.toString("base64")}`)).toBe(false);
    });

    it("decrypts data written by the legacy format", () => {
        const legacyCipherText = "ABEiM0RVZneImaq7zN3u/xCu6DJsO+tahOtyMRFS7bg5ktWBl8h82Ul9Efyxn1QQ";

        expect(dataEncryption.decryptString(key, legacyCipherText)).toBe("legacy protected value");
    });
});
