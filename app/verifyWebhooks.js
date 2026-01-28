import crypto from "crypto";

export async function verifyWebhook(request) {
    const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
    const secret = process.env.SHOPIFY_API_SECRET;

    if (!hmacHeader) {
        console.error("❌ [VerifyWebhook] Missing X-Shopify-Hmac-Sha256 header");
        return false;
    }

    if (!secret) {
        console.error("❌ [VerifyWebhook] Missing SHOPIFY_API_SECRET environment variable");
        return false;
    }

    try {
        const requestClone = request.clone();
        const body = await requestClone.text();

        console.log(`🔍 [VerifyWebhook] Body Length: ${body.length}`);
        
        const generatedHash = crypto
            .createHmac("sha256", secret)
            .update(body, "utf8")
            .digest("base64");

        console.log(`🔍 [VerifyWebhook] Received HMAC: ${hmacHeader}`);
        console.log(`🔍 [VerifyWebhook] Generated HMAC: ${generatedHash}`);

        const signatureBuffer = Buffer.from(hmacHeader, "utf8");
        const generatedBuffer = Buffer.from(generatedHash, "utf8");

        if (signatureBuffer.length !== generatedBuffer.length) {
            console.warn("⚠️ [VerifyWebhook] HMAC length mismatch");
            return false;
        }

        const isValid = crypto.timingSafeEqual(signatureBuffer, generatedBuffer);

        if (!isValid) {
            console.warn("⚠️ [VerifyWebhook] HMAC signature mismatch");
        } else {
            console.log("✅ [VerifyWebhook] HMAC Verified Successfully");
        }

        return isValid;
    } catch (error) {
        console.error("❌ [VerifyWebhook] Error verifying webhook HMAC:", error);
        return false;
    }
}
