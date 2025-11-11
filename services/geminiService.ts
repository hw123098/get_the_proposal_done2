import { GoogleGenAI, Type } from "@google/genai";
import type { Paper, TreeNode, NetworkEdge } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

const treeNodeSchema = {
    type: Type.OBJECT,
    properties: {
        keyword: { type: Type.STRING, description: "A concise academic keyword or phrase." },
        children: {
            type: Type.ARRAY,
            description: "An array of child keywords. Should contain around 5-7 items.",
            items: {
                type: Type.OBJECT,
                properties: {
                    keyword: { type: Type.STRING },
                    label: { type: Type.STRING, enum: ['hot', 'classic', 'niche', 'bridge'] },
                },
                required: ['keyword'],
            },
        },
    },
    required: ['keyword', 'children'],
};


export const generateInitialTrees = async (rootKeywords: string[]): Promise<TreeNode[]> => {
    if (!rootKeywords || rootKeywords.length === 0) {
        throw new Error("Please enter at least one root keyword to begin.");
    }

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Generate a starting research tree for EACH of the following academic topics: ${JSON.stringify(rootKeywords)}.
If a topic is in Chinese, generate its tree in Chinese.
For each topic, the root should be the keyword itself. Create around 5-7 main branches (sub-keywords).

**Crucially, prioritize sub-keywords that are not only relevant to their own root but also create connections or bridges to the OTHER provided topics.** The goal is an interconnected knowledge map.
Assign one of the following labels to each generated sub-keyword:
- 'hot': A currently trending or popular area of research.
- 'classic': A foundational or well-established concept.
- 'niche': A highly specialized or less-common subfield.
- 'bridge': A sub-keyword that explicitly connects to one of the other root topics.`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        trees: {
                            type: Type.ARRAY,
                            items: treeNodeSchema
                        }
                    },
                    required: ['trees']
                },
            },
        });
        
        const data = JSON.parse(response.text);

        const roots: TreeNode[] = data.trees.map((treeData: any) => {
             const rootKeyword = treeData.keyword;
             return {
                id: rootKeyword.toLowerCase().replace(/\s+/g, '-'),
                keyword: rootKeyword,
                children: treeData.children.map((child: any, index: number) => ({
                    id: `${rootKeyword}-${child.keyword}-${index}`.toLowerCase().replace(/\s+/g, '-'),
                    keyword: child.keyword,
                    label: child.label,
                    children: [],
                })),
             }
        });
        
        // Ensure the model returned trees for the requested keywords
        const returnedKeywords = new Set(roots.map(r => r.keyword));
        const missingKeywords = rootKeywords.filter(k => !returnedKeywords.has(k));
        if (missingKeywords.length > 0) {
            // Handle cases where the model might not return all requested trees
            console.warn(`Model did not return trees for: ${missingKeywords.join(', ')}`);
        }


        return roots;

    } catch (error) {
        console.error("Error generating initial trees:", error);
        throw new Error(`Failed to generate research trees for "${rootKeywords.join(', ')}".`);
    }
};

export const expandTreeNode = async (parentKeyword: string): Promise<Omit<TreeNode, 'id' | 'children'>[]> => {
     try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `The user wants to expand their research tree from the keyword "${parentKeyword}". If the keyword is in Chinese, generate Chinese results. Generate around 5-7 new, more specific sub-keywords related to it. Include a diverse range of topics. For each, provide a label ('hot', 'classic', or 'niche').`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        expansions: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    keyword: { type: Type.STRING },
                                    label: { type: Type.STRING, enum: ['hot', 'classic', 'niche'] },
                                },
                                required: ['keyword'],
                            }
                        }
                    },
                    required: ['expansions']
                },
            },
        });
        
        const data = JSON.parse(response.text);
        return data.expansions;

    } catch (error) {
        console.error("Error expanding tree node:", error);
        throw new Error("Failed to expand the research topic.");
    }
}

export const generateKeywordNetwork = async (keywords: string[]): Promise<NetworkEdge[]> => {
    if (keywords.length < 2) {
        return [];
    }
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Given this list of academic keywords: ${JSON.stringify(keywords)}. Identify the direct relationships between them. If they are in Chinese, provide Chinese relationships.
Represent these as connections, each with 'from', 'to', 'type', and a brief 'description'.

Use ONLY the following relationship 'type' values:
- 'HIERARCHICAL': One keyword is a subfield or component of another.
- 'DEPENDENCY': One keyword enables, requires, or is a prerequisite for another.
- 'SYNONYM': The keywords are different terms for the same or very similar concepts.
- 'CONTRASTING': The keywords represent opposing or alternative theories/approaches.
- 'ASSOCIATIVE': The keywords are often studied together or are related in a non-hierarchical way.

Only include connections between the provided keywords.`,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        connections: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    from: { type: Type.STRING, description: 'One of the provided keywords.' },
                                    to: { type: Type.STRING, description: 'Another one of the provided keywords.' },
                                    type: { type: Type.STRING, enum: ['HIERARCHICAL', 'DEPENDENCY', 'SYNONYM', 'CONTRASTING', 'ASSOCIATIVE'] },
                                    description: { type: Type.STRING, description: 'A brief explanation of the relationship.' },
                                },
                                required: ['from', 'to', 'type']
                            }
                        }
                    },
                    required: ['connections']
                }
            }
        });

        const data = JSON.parse(response.text);
        // Filter to ensure the model only returned valid connections
        return data.connections.filter((edge: any) => keywords.includes(edge.from) && keywords.includes(edge.to));

    } catch (error) {
        console.error("Error generating keyword network:", error);
        throw new Error("Failed to generate the keyword network graph.");
    }
};


export const findLiterature = async (keyword: string): Promise<Paper[]> => {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: `As an expert academic librarian, your task is to find real, verifiable academic papers for the user's research topic.

Research Topic: "${keyword}"

**Instructions:**
1.  **Find & Verify:** Use your search tool to find up to 8 relevant academic papers. For each paper, you must verify its existence.
2.  **Prioritize Sources:** You **must** prioritize results from reputable academic search engines like Google Scholar, Baidu Scholar, arXiv, PubMed, or official university/publisher websites. The URL must lead directly to the paper's landing page where the abstract or full text can be accessed.
3.  **Chinese Topics:** If the topic is in Chinese, results from "Baidu Scholar" (xueshu.baidu.com) are highly preferred.
4.  **Fallback URL:** If a direct link to a paper cannot be found, provide a search link to that paper on Google Scholar or Baidu Scholar.
5.  **Summarize:** For each paper, write a brief, one-to-two sentence summary of its key findings **in your own words**. Do not copy the abstract.
6.  **Format:** Return the verified information as a single JSON object. Do not include any other text or markdown formatting. The JSON should be clean and parseable.

**JSON Output Format:**
The JSON object must have a key "papers", which is an array of paper objects. Each paper object must contain:
- "title": The full title of the paper.
- "authors": An array of author names.
- "year": The publication year (number).
- "abstract": Your brief summary of the paper's key findings.
- "citations": The citation count (number, if available).
- "url": The direct, verifiable URL to the paper's landing page.

**Important:**
- Prioritize accuracy. It is better to return fewer, fully verified papers than a list with unverified entries.
- Do not invent papers or URLs. If you cannot find and verify a paper, do not include it.`,
            config: {
                tools: [{googleSearch: {}}],
            },
        });

        let rawText = response.text;
        
        if (!rawText) {
            console.error("Model returned no text response for keyword:", keyword);
            const finishReason = response.candidates?.[0]?.finishReason;
            const safetyRatings = response.candidates?.[0]?.safetyRatings;
            console.error("Finish Reason:", finishReason);
            console.error("Safety Ratings:", JSON.stringify(safetyRatings, null, 2));
            throw new Error("Failed to find literature: The model returned an empty response.");
        }
        
        const jsonMatch = rawText.match(/```json([\s\S]*)```|({[\s\S]*})/);
        if (!jsonMatch) {
            console.error("Raw response from model:", rawText);
            throw new Error("Failed to parse JSON from model response. No JSON object found.");
        }
        rawText = jsonMatch[1] || jsonMatch[2];

        const data = JSON.parse(rawText);
        
        if (!data.papers || !Array.isArray(data.papers)) {
            return [];
        }

        // The model now provides the URL directly. We just need to validate the structure.
        const papers: Paper[] = data.papers.filter((p: any): p is Paper => 
            p && typeof p.title === 'string' && typeof p.url === 'string'
        );

        return papers;
    } catch (error) {
        console.error("Error finding literature:", error);
        if (error instanceof SyntaxError) {
             throw new Error("Failed to find literature: The model returned an invalid format.");
        }
        if (error instanceof Error && error.message.startsWith("Failed to find literature:")) {
            throw error;
        }
        throw new Error(`Failed to find literature for "${keyword}".`);
    }
};