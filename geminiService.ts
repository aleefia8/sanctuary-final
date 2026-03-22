import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function getHealthAdvice(prompt: string, userContext: any): Promise<string> {
  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `User Context: ${JSON.stringify(userContext)}\n\nPrompt: ${prompt}`,
      config: {
        systemInstruction: "You are SanctuaryOS AI, a clinical-grade health coach. Provide evidence-based, personalized health advice based on the user's biometric data. Use Google Search to find the latest health research if needed. Be professional, encouraging, and precise.",
        tools: [{ googleSearch: {} }],
      },
    });
    return response.text || "I'm sorry, I couldn't generate a response at this time.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "An error occurred while fetching health advice.";
  }
}
