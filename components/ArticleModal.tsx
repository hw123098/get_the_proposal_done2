
import React, { useEffect } from 'react';
import { CloseIcon } from './icons/CloseIcon';

interface ArticleModalProps {
    isOpen: boolean;
    isLoading: boolean;
    error: string;
    content: string;
    onClose: () => void;
}

const LoadingState: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full text-center p-8">
    <svg className="animate-spin h-8 w-8 text-cyan-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    <p className="mt-4 text-slate-300">Reading article, please wait...</p>
  </div>
);

const ErrorState: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-red-900/20 border border-red-500/50 rounded-lg">
     <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-red-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
    <h3 className="text-lg font-semibold text-red-300">Could Not Read Article</h3>
    <p className="mt-2 text-sm text-red-400">{message}</p>
  </div>
);

export const ArticleModal: React.FC<ArticleModalProps> = ({ isOpen, isLoading, error, content, onClose }) => {
    useEffect(() => {
        const handleEsc = (event: KeyboardEvent) => {
           if (event.key === 'Escape') {
              onClose();
           }
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    if (!isOpen) return null;

    const renderContent = () => {
        if (isLoading) return <LoadingState />;
        if (error) return <ErrorState message={error} />;
        if (!content) return <ErrorState message="The API returned empty content for this article." />;
        
        return (
            <div 
                className="prose prose-invert prose-sm sm:prose-base max-w-none text-slate-300 prose-headings:text-slate-100 prose-strong:text-slate-100 prose-a:text-cyan-400 prose-a:no-underline hover:prose-a:underline"
                dangerouslySetInnerHTML={{ __html: content.replace(/\n/g, '<br />') }}
            />
        );
    };

    return (
        <div 
            className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in p-4"
            style={{ animationDuration: '200ms' }}
            onClick={onClose}
        >
            <div 
                className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-3xl h-[90vh] flex flex-col shadow-2xl relative"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex-shrink-0 p-4 border-b border-slate-700 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-slate-200">Article View</h2>
                     <button onClick={onClose} className="p-2 text-slate-400 hover:text-white transition-colors rounded-full hover:bg-slate-700">
                        <CloseIcon className="w-5 h-5" />
                    </button>
                </div>
                <div className="flex-grow p-6 overflow-y-auto">
                   {renderContent()}
                </div>
            </div>
        </div>
    );
};
