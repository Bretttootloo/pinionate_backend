import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Stripe from "stripe";
import axios from "axios";

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;


app.use(cors({
  origin: "https://pinionate.com",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  credentials: true,
}));
app.options("*", cors());

app.use(express.json());

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.post("/create-checkout-session", async (req, res) => {
  console.log("💳 Received checkout POST request");

  
     const { discount } = req.body; // NEW expects "discount" boolean
    const priceId = discount
      ? "price_1RbCAOEQ22SY5ldZvgRrFfex" // NEW discount product id
      : "price_1RbCAOEQ22SY5ldZuUu9DOeO"; // NEW regular product id
    try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "payment",
      success_url: "https://pinionate.com/success?paid=true",
      cancel_url: "https://pinionate.com",
    });

    console.log("✅ Created session:", session.id);
    res.json({ sessionId: session.id });
  } catch (error) {
    console.error("Stripe checkout error:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

console.log(
  "GOOGLE_SEARCH_ENGINE_ID:",
  process.env.GOOGLE_SEARCH_ENGINE_ID ? "[loaded]" : "❌ missing"
);
console.log(
  "GOOGLE_API_KEY:",
  process.env.GOOGLE_API_KEY ? "[loaded]" : "❌ missing"
);
console.log(
  "OPENAI_API_KEY:",
  process.env.OPENAI_API_KEY ? "[loaded]" : "❌ missing"
);
console.log(
  "STRIPE_SECRET_KEY:",
  process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_")
    ? "[live key loaded]"
    : "❌ missing live key"
);

app.post("/api/analyze", async (req, res) => {
  console.log("Incoming request body:", req.body);

  const { publicFigure, topic } = req.body;
  if (!publicFigure || !topic) {
    return res.status(400).json({ error: "Missing publicFigure or topic" });
  }

  try {
    const query = `${publicFigure} ${topic}`;
    console.log("Running Google search for:", query);

    const searchUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(
      query
    )}&cx=${process.env.GOOGLE_SEARCH_ENGINE_ID}&key=${
      process.env.GOOGLE_API_KEY
    }&num=10`;

    const searchResp = await axios.get(searchUrl);
    const items = searchResp.data.items || [];
    console.log(`Google returned ${items.length} results`);

    const snippets = items
      .map(
        (item) =>
          `Title: ${item.title}\nSnippet: ${item.snippet}\nLink: ${item.link}`
      )
      .join("\n\n");

    const openaiPrompt = `
You are a data-only JSON generator.

Analyze the stance of the public figure on the given topic based on these recent articles:

${snippets}

Output ONLY and EXACTLY this JSON format:

{
  "score": number from -10 to 10,
  "summary": "short summary"
}
`;

    const openaiResp = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant. Respond only in valid JSON.",
          },
          { role: "user", content: openaiPrompt },
        ],
        temperature: 0.3,
        max_tokens: 300,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    const openaiMessage = openaiResp.data.choices[0].message.content;
    console.log("OpenAI response:", openaiMessage);

    let result;
    try {
      result = JSON.parse(openaiMessage);
    } catch {
      const match = openaiMessage.match(/\{[\s\S]*?\}/);
      if (match) {
        try {
          result = JSON.parse(match[0]);
        } catch (e) {
          console.warn("Nested parse still failed:", e);
          result = { score: 0, summary: "Could not parse AI response." };
        }
      } else {
        console.warn("No JSON found at all.");
        result = { score: 0, summary: "Could not parse AI response." };
      }
    }

    res.json({
      stance: result.score,
      summary: result.summary,
      sourcesCount: items.length,
      sources: items.map((item) => ({
        title: item.title,
        snippet: item.snippet,
        link: item.link,
      })),
      dateRange: `As of ${new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}`,
    });
  } catch (error) {
    if (error.response) {
      console.error(
        "API response error:",
        error.response.status,
        error.response.data
      );
    } else {
      console.error("Error:", error.message || error);
    }
    res.status(500).json({ error: "Failed to analyze stance" });
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
