const multer = require('multer');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4', // Correct MIME type for m4a
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac'
  };
  return mimeTypes[ext] || null; // Return null if the MIME type is not found
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await runMiddleware(req, res, upload.single('audio'));

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const mimeType = getMimeType(req.file.originalname);
    if (!mimeType) {
      return res.status(400).json({ error: `Unsupported file type: ${path.extname(req.file.originalname)}` });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const audioPart = {
      inlineData: {
        data: req.file.buffer.toString('base64'),
        mimeType: mimeType,
      },
    };

    const prompt = `Generate a transcript and a concise summary with bullet points of the provided audio file. Format the response as a single JSON object with two keys: "transcript" and "summary".`;

    const result = await model.generateContent([prompt, audioPart]);
    const responseText = result.response.text();
  
    if (!responseText) {
      return res.status(500).json({ error: 'API response was not a valid text string.' });
    }
  
    // Use a regex to extract the JSON part of the string
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch || !jsonMatch[0]) {
      return res.status(500).json({ error: 'Failed to find a JSON object in the API response.' });
    }
  
    const jsonString = jsonMatch[0];
    const parsedResponse = JSON.parse(jsonString);
  
    res.json({
      transcript: parsedResponse.transcript,
      summary: parsedResponse.summary,
      success: true
    });
  
  } catch (error) {
    console.error('An error occurred:', error);
    // Ensure all errors return a JSON response
    res.status(500).json({ error: error.message });
  }
};