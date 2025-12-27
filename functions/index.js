const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(functions.config().gemini.api_key);

exports.verifyHazard = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    return { success: false, reason: 'Unauthorized' };
  }

  // Simple rate limit (5 per minute per user)
  const recent = await admin.firestore().collection('rate-limit')
    .where('uid', '==', context.auth.uid)
    .where('timestamp', '>', Date.now() - 60000)
    .get();
  if (recent.size >= 5) {
    return { success: false, reason: 'Rate limit exceeded' };
  }
  await admin.firestore().collection('rate-limit').add({
    uid: context.auth.uid,
    timestamp: Date.now()
  });

  // Image size limit
  if (data.imageBase64.length > 8e6) {
    return { success: false, reason: 'Image too large' };
  }

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `You are an expert environmental hazard detector. Analyze the image and classify it into EXACTLY ONE of these categories or reject:

Categories:
1. pothole - severe road potholes affecting safety
2. waste - illegal solid waste/garbage dumps
3. pollution - visible contamination in water bodies, beaches, or shorelines

Rules:
- Only classify if the hazard is clearly visible and matches the description.
- Reject if irrelevant, blurry, low quality, or not one of the three.
- Output ONLY valid JSON: {"category":"pothole|waste|pollution|reject","reasoning":"short explanation","confidence":0-100}

Image:`;

  try {
    const result = await model.generateContent([
      prompt,
      { inlineData: { data: data.imageBase64, mimeType: "image/jpeg" } }
    ]);
    const json = JSON.parse(result.response.text());

    if (json.category === 'reject' || json.confidence < 75) {
      return { success: false, reason: json.reasoning || 'Low confidence' };
    }

    // Store verified hazard
    const file = admin.storage().bucket().file(`hazards/${Date.now()}_${context.auth.uid}.jpg`);
    await file.save(Buffer.from(data.imageBase64, 'base64'), { contentType: 'image/jpeg' });
    const [url] = await file.getSignedUrl({ action: 'read', expires: '01-01-2100' });

    await admin.firestore().collection('hazards').add({
      uid: context.auth.uid,
      category: json.category,
      reasoning: json.reasoning,
      confidence: json.confidence,
      lat: data.lat,
      lng: data.lng,
      timestamp: data.timestamp,
      imageUrl: url
    });

    return { success: true };
  } catch (err) {
    return { success: false, reason: 'Verification error' };
  }
});
