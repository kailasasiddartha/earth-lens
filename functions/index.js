const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const { GoogleGenAI } = require('@google/genai');

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

exports.verifyHazard = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    return { success: false, reason: 'Unauthorized' };
  }

  // Rate limit: 5 per minute per user
  const snapshot = await admin.firestore().collection('rate-limit')
    .where('uid', '==', context.auth.uid)
    .where('timestamp', '>', Date.now() - 60000)
    .get();
  if (snapshot.size >= 5) {
    return { success: false, reason: 'Rate limit exceeded' };
  }
  await admin.firestore().collection('rate-limit').add({ uid: context.auth.uid, timestamp: Date.now() });

  // Image size limit ~6MB base64
  if (data.imageBase64.length > 8e6) {
    return { success: false, reason: 'Image too large' };
  }

  const model = genAI.getGenerativeModel({ model: "gemini-3-flash" });

  const prompt = `You are an expert hazard detector. Analyze the image and classify it into EXACTLY ONE category or reject.

Categories:
- pothole: severe road potholes
- waste: illegal solid waste dumps
- pollution: visible contamination in water bodies, beaches, shorelines

Rules:
- Must be clearly visible and match exactly.
- Reject blurry, irrelevant, or low-quality images.
- Output ONLY valid JSON: {"category":"pothole|waste|pollution|reject","reasoning":"short reason","confidence":0-100}

Image:`;

  const result = await model.generateContent([
    prompt,
    { inlineData: { data: data.imageBase64, mimeType: "image/jpeg" } }
  ]);

  let json;
  try {
    json = JSON.parse(result.response.text());
  } catch (e) {
    return { success: false, reason: 'AI parsing error' };
  }

  if (json.category === 'reject' || json.confidence < 75) {
    return { success: false, reason: json.reasoning || 'Low confidence' };
  }

  const file = admin.storage().bucket().file(`hazards/${Date.now()}_${context.auth.uid}.jpg`);
  await file.save(Buffer.from(data.imageBase64, 'base64'), { contentType: 'image/jpeg' });
  const [url] = await file.getSignedUrl({ action: 'read', expires: '01-01-2100' });

  await admin.firestore().collection('hazards').add({
    ...data,
    category: json.category,
    reasoning: json.reasoning,
    confidence: json.confidence,
    imageUrl: url
  });

  return { success: true };
});
