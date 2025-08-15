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
  return mimeTypes[ext] || null;
}

module.exports = async (req, res) => {
  // Set CORS headers first
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed. Only POST requests are accepted.',
      success: false 
    });
  }

  try {
    // Handle file upload
    await runMiddleware(req, res, upload.single('audio'));
    
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No audio file provided',
        success: false 
      });
    }

    const mimeType = getMimeType(req.file.originalname);
    if (!mimeType) {
      return res.status(400).json({ 
        error: `Unsupported file type: ${path.extname(req.file.originalname)}`,
        success: false 
      });
    }

    // Check for API key
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ 
        error: 'API key not configured',
        success: false 
      });
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
      return res.status(500).json({ 
        error: 'Empty response from AI service',
        success: false 
      });
    }

    // Clean the response text and extract JSON
    const cleanedResponse = responseText.replace(/```json\s*|\s*```/g, '').trim();
    
    let parsedResponse;
    try {
      // First try to parse the cleaned response directly
      parsedResponse = JSON.parse(cleanedResponse);
    } catch (parseError) {
      // If that fails, try to extract JSON using regex
      const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch || !jsonMatch[0]) {
        return res.status(500).json({ 
          error: 'Invalid response format from AI service',
          success: false 
        });
      }
      
      try {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } catch (secondParseError) {
        return res.status(500).json({ 
          error: 'Failed to parse AI response as JSON',
          success: false 
        });
      }
    }

    // Validate the response has required fields
    if (!parsedResponse.transcript && !parsedResponse.summary) {
      return res.status(500).json({ 
        error: 'AI response missing required fields',
        success: false 
      });
    }

    return res.status(200).json({
      transcript: parsedResponse.transcript || 'No transcript available',
      summary: parsedResponse.summary || 'No summary available',
      success: true
    });

  } catch (error) {
    console.error('API Error:', error);
    
    // Ensure we haven't already sent a response
    if (!res.headersSent) {
      return res.status(500).json({ 
        error: error.message || 'Internal server error',
        success: false 
      });
    }
  }
};