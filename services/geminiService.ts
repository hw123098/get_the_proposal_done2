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
    const METASO_API_ENDPOINT = 'https://metaso.cn/api/v1/search'; 
    const apiKey = process.env.METASO_API_KEY;

    if (!apiKey) {
        throw new Error("Metaso API key is not configured. Please set METASO_API_KEY in your Vercel project settings.");
    }

    try {
        const response = await fetch(METASO_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                q: keyword,
                scope: "webpage",
                size: "10",
                includeSummary: true,
                includeRawContent: false,
                conciseSnippet: false,
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("Metaso API Error:", errorBody);
            throw new Error(`Metaso API request failed with status ${response.status}.`);
        }

        const data = await response.json();
        
        // Based on the user's screenshot, the results are in the 'webpages' array.
        const results = data.webpages || []; 

        if (!Array.isArray(results)) {
             console.warn("Metaso API response did not contain a 'webpages' array.", data);
             return [];
        }

        // Map the API response to the 'Paper' type used in this application.
        const papers: Paper[] = results.map((p: any): Paper => ({
            title: p.title || 'No Title Provided',
            // Web search results don't typically provide structured author data.
            authors: [],
            // Web search results don't provide a publication year.
            year: 0,
            // The 'snippet' field from the API response corresponds to our 'abstract'.
            abstract: p.snippet || 'No abstract available.',
            // The 'link' field from the API response corresponds to our 'url'.
            url: p.link || '#',
            // Web search results don't provide citation counts.
            citations: undefined,
        }));

        return papers;

    } catch (error) {
        console.error("Error finding literature via Metaso:", error);
        if (error instanceof SyntaxError) {
             throw new Error("Failed to find literature: The Metaso API returned an invalid format (not valid JSON).");
        }
        if (error instanceof Error && error.message.includes("Metaso API")) {
            throw error; // Re-throw our specific API errors
        }
        throw new Error(`An unexpected error occurred while fetching literature for "${keyword}" from Metaso.`);
    }
};