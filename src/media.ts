import crypto from "node:crypto";
import axios from "axios";
import { decodeEncodingAESKey, pkcs7Unpad, WECOM_PKCS7_BLOCK_SIZE } from "./crypto.js";

/**
 * Download and decrypt WeCom media file (e.g. image).
 * 
 * WeCom media files are AES-256-CBC encrypted with the same EncodingAESKey.
 * The IV is the first 16 bytes of the AES Key.
 * The content is PKCS#7 padded.
 */
export async function decryptWecomMedia(url: string, encodingAESKey: string, maxBytes?: number): Promise<Buffer> {
    // 1. Download encrypted content
    const response = await axios.get(url, {
        responseType: "arraybuffer", // Important: get raw buffer
        timeout: 15000,
        maxContentLength: maxBytes || undefined, // Limit download size
        maxBodyLength: maxBytes || undefined,
    });
    const encryptedData = Buffer.from(response.data);

    // 2. Prepare Key and IV
    const aesKey = decodeEncodingAESKey(encodingAESKey);
    const iv = aesKey.subarray(0, 16);

    // 3. Decrypt
    const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);
    decipher.setAutoPadding(false); // We handle padding manually
    const decryptedPadded = Buffer.concat([
        decipher.update(encryptedData),
        decipher.final(),
    ]);

    // 4. Unpad
    // Note: Unlike msg bodies, usually removing PKCS#7 padding is enough for media files.
    // The Python SDK logic: pad_len = decrypted_data[-1]; decrypted_data = decrypted_data[:-pad_len]
    // Our pkcs7Unpad function does exactly this + validation.
    return pkcs7Unpad(decryptedPadded, WECOM_PKCS7_BLOCK_SIZE);
}
