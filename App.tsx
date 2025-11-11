
import React, { useState, useCallback } from 'react';
import type { TreeNode, NetworkData, Paper, CollectedPaper, NetworkNode } from './types';

import { Header } from './components/Header';
import { KeywordInput } from './components/KeywordInput';
import { ResearchExplorer } from './components/ResearchExplorer';

import * as GeminiService from './services/geminiService';
import { ITERATION_LIMIT } from './constants';

const App: React.FC = () => {
    const [view, setView] = useState<'input' | 'explorer'>('input');
    const [trees, setTrees] = useState<TreeNode[]>([]);
    const [networkData, setNetworkData] = useState<NetworkData | null>(null);
    const [selectedNodeForLiterature, setSelectedNodeForLiterature] = useState<TreeNode | null>(null);
    const [selectedForNetwork, setSelectedForNetwork] = useState<Set<string>>(new Set());
    const [collectedPapers, setCollectedPapers] = useState<CollectedPaper[]>([]);
    const [iterations, setIterations] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [error, setError] = useState('');

    const findAndModifyNode = (nodes: TreeNode[], nodeId: string, modification: (node: TreeNode) => void): TreeNode[] => {
        return nodes.map(node => {
            if (node.id === nodeId) {
                modification(node);
                return { ...node };
            }
            if (node.children && node.children.length > 0) {
                return { ...node, children: findAndModifyNode(node.children, nodeId, modification) };
            }
            return node;
        });
    };
    
    const handleSearch = useCallback(async (keywords: string[]) => {
        setIsLoading(true);
        setLoadingMessage('Generating interconnected research network...');
        setError('');
        setIterations(1);
        try {
            const initialTrees = await GeminiService.generateInitialTrees(keywords);
            setTrees(initialTrees);

            const allKeywords = new Set<string>();
            const addKeywordsToSet = (nodes: TreeNode[]) => {
                nodes.forEach(node => {
                    allKeywords.add(node.keyword);
                    if (node.children) addKeywordsToSet(node.children);
                });
            };
            addKeywordsToSet(initialTrees);
            setSelectedForNetwork(allKeywords);
            
            const edges = await GeminiService.generateKeywordNetwork(Array.from(allKeywords));
            const nodes: NetworkNode[] = Array.from(allKeywords).map(kw => ({ id: kw, label: kw }));
            setNetworkData({ nodes, edges });
            
            setView('explorer');
        } catch (err: any) {
            setError(err.message || "An unknown error occurred.");
            setView('input');
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    }, []);

    const handleNodeSelectForLiterature = useCallback(async (node: TreeNode) => {
        // Toggle selection: if clicking the same node, deselect it. Otherwise, select the new node.
        if (selectedNodeForLiterature?.id === node.id) {
            setSelectedNodeForLiterature(null);
            return;
        }

        setSelectedNodeForLiterature(node);
        if (!node.literature && !node.isLoading) {
             setTrees(prevTrees => findAndModifyNode(prevTrees, node.id, n => {
                n.isLoading = true;
            }));
            try {
                const papers = await GeminiService.findLiterature(node.keyword);
                setTrees(prevTrees => findAndModifyNode(prevTrees, node.id, n => {
                    n.literature = papers;
                    n.isLoading = false;
                }));
                 setSelectedNodeForLiterature(prev => prev && prev.id === node.id ? { ...prev, literature: papers, isLoading: false } : prev);
            } catch (err: any) {
                setError(err.message || "Failed to fetch literature.");
                 setTrees(prevTrees => findAndModifyNode(prevTrees, node.id, n => {
                    n.isLoading = false;
                }));
            }
        }
    }, [selectedNodeForLiterature]);

    const handleNodeExpand = useCallback(async (nodeId: string, parentKeyword: string) => {
        if (iterations >= ITERATION_LIMIT) {
            setError("Iteration limit reached. Please start a new session to continue.");
            return;
        }
        setIterations(prev => prev + 1);
        setTrees(prevTrees => findAndModifyNode(prevTrees, nodeId, n => {
            n.isLoading = true;
        }));
        try {
            const expansions = await GeminiService.expandTreeNode(parentKeyword);
            setTrees(prevTrees => findAndModifyNode(prevTrees, nodeId, n => {
                n.children = expansions.map((exp, index) => ({
                    id: `${nodeId}-${exp.keyword.replace(/\s+/g, '-')}-${index}`,
                    keyword: exp.keyword,
                    label: exp.label as any,
                    children: [],
                }));
                n.isLoading = false;
            }));
        } catch (err: any) {
            setError(err.message || "Failed to expand node.");
            setTrees(prevTrees => findAndModifyNode(prevTrees, nodeId, n => {
                n.isLoading = false;
            }));
        }
    }, [iterations]);

    const handleNodeCheck = useCallback((keyword: string, isChecked: boolean) => {
        setSelectedForNetwork(prev => {
            // FIX: Explicitly type the new Set to maintain type safety. This prevents
            // `selectedForNetwork` from being inferred as `Set<unknown>` which caused
            // downstream errors in `handleUpdateNetwork`.
            const newSet = new Set<string>(prev);
            if (isChecked) {
                newSet.add(keyword);
            } else {
                newSet.delete(keyword);
            }
            return newSet;
        });
    }, []);

    const handleUpdateNetwork = useCallback(async () => {
        if (iterations >= ITERATION_LIMIT) {
            setError("Iteration limit reached.");
            return;
        }
        setIsLoading(true);
        setLoadingMessage('Updating keyword network...');
        setError('');
        setIterations(prev => prev + 1);
        try {
            const keywords = Array.from(selectedForNetwork);
            const edges = await GeminiService.generateKeywordNetwork(keywords);
            const nodes: NetworkNode[] = keywords.map(kw => ({ id: kw, label: kw }));
            setNetworkData({ nodes, edges });
        } catch (err: any) {
            setError(err.message || "Failed to update network.");
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    }, [selectedForNetwork, iterations]);

    const handleToggleCollectPaper = useCallback((paper: Paper, sourceKeyword: string) => {
        setCollectedPapers(prev => {
            const isCollected = prev.some(p => p.paper.title === paper.title);
            if (isCollected) {
                return prev.filter(p => p.paper.title !== paper.title);
            } else {
                return [...prev, { paper, sourceKeyword }];
            }
        });
    }, []);

    const handleRefreshTree = useCallback(async (treeToRefresh: TreeNode) => {
        if (iterations >= ITERATION_LIMIT) {
            setError("Iteration limit reached.");
            return;
        }
        setIsLoading(true);
        setLoadingMessage(`Refreshing tree for "${treeToRefresh.keyword}"...`);
        setError('');
        setIterations(prev => prev + 1);
        try {
            // Regenerate all trees to maintain context and connections
            const allRootKeywords = trees.map(t => t.keyword);
            const newTrees = await GeminiService.generateInitialTrees(allRootKeywords);
            setTrees(newTrees);
        } catch (err: any) {
            setError(err.message || "Failed to refresh tree.");
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    }, [iterations, trees]);

    const handleExportJson = useCallback(() => {
        const data = {
            trees,
            networkData,
            collectedPapers,
            selectedForNetwork: Array.from(selectedForNetwork),
        };
        const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(data, null, 2))}`;
        const link = document.createElement('a');
        link.href = jsonString;
        link.download = `research-explorer-data-${Date.now()}.json`;
        link.click();
    }, [trees, networkData, collectedPapers, selectedForNetwork]);

    const handleExportNetworkPng = useCallback(() => {
        const svg = document.getElementById('network-svg-view');
        if (!svg) {
            alert('Network graph not found.');
            return;
        }

        const svgData = new XMLSerializer().serializeToString(svg);
        const canvas = document.createElement('canvas');
        const svgSize = svg.getBoundingClientRect();
        canvas.width = svgSize.width * 2; // Increase resolution
        canvas.height = svgSize.height * 2;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
             alert('Could not get canvas context.');
             return;
        }

        const img = new Image();
        img.onload = () => {
            ctx.fillStyle = '#1e293b'; // bg-slate-800
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const pngFile = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = pngFile;
            link.download = `research-network-${Date.now()}.png`;
            link.click();
        };
        img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;
    }, []);

    return (
        <main className="bg-slate-900 min-h-screen flex flex-col font-sans text-white antialiased">
            {error && (
                <div className="bg-red-500/80 text-white p-3 text-center text-sm sticky top-0 z-50 flex justify-between items-center">
                    <span><strong>Error:</strong> {error}</span>
                    <button onClick={() => setError('')} className="font-bold text-lg leading-none">&times;</button>
                </div>
            )}
            {view === 'explorer' && <Header onExportJson={handleExportJson} onExportNetworkPng={handleExportNetworkPng} />}
            <div className="flex-grow flex flex-col p-4 sm:p-6 container mx-auto">
                {view === 'input' && <KeywordInput onSearch={handleSearch} />}
                {view === 'explorer' && (
                    <ResearchExplorer
                        trees={trees}
                        networkData={networkData}
                        selectedNodeForLiterature={selectedNodeForLiterature}
                        selectedForNetwork={selectedForNetwork}
                        collectedPapers={collectedPapers}
                        iterations={iterations}
                        isLoading={isLoading}
                        loadingMessage={loadingMessage}
                        onNodeSelectForLiterature={handleNodeSelectForLiterature}
                        onClearLiteratureFocus={() => setSelectedNodeForLiterature(null)}
                        onNodeExpand={handleNodeExpand}
                        onNodeCheck={handleNodeCheck}
                        onUpdateNetwork={handleUpdateNetwork}
                        onToggleCollectPaper={handleToggleCollectPaper}
                        onRefreshTree={handleRefreshTree}
                    />
                )}
            </div>
        </main>
    );
};

export default App;
