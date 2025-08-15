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
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac'
  };
  return mimeTypes[ext] || 'audio/mpeg';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await runMiddleware(req, res, upload.single('audio'));

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const audioPart = {
      inlineData: {
        data: req.file.buffer.toString('base64'),
        mimeType: getMimeType(req.file.originalname),
      },
    };

    const transcriptionResult = await model.generateContent([
      'Generate a transcript of the provided audio file.',
      audioPart
    ]);
    const transcript = transcriptionResult.response.text();

    const summaryResult = await model.generateContent([
      'Please create a concise summary and bullet points, just like taking notes, of the following transcript:\n\n' + transcript
    ]);
    const summary = summaryResult.response.text();

    res.json({
      transcript,
      summary,
      success: true
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};